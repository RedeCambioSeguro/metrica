/**
 * Sincronizacao diaria, disparada pelo cron da Vercel (ver vercel.json).
 *
 * Duas responsabilidades, nesta ordem:
 *   1. Consumir a fila de SyncJob pendente (o backfill historico).
 *   2. Atualizar a janela recente de cada conexao ativa.
 *
 * O tempo limite de funcao na Vercel e curto, entao a rota trabalha ate perto
 * do limite e para. O que sobrar fica pendente e sai na proxima execucao - por
 * isso os jobs sao pequenos e idempotentes.
 */

import { NextResponse } from "next/server";

import { safeEquals } from "@/lib/crypto";
import { fromUtcDate } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import {
  syncConnectionIncremental,
  syncConnectionRange,
} from "@/server/sync/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Margem para responder antes de a plataforma encerrar a funcao. */
const ORCAMENTO_MS = 50_000;

function autorizado(request: Request): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return false;

  const cabecalho = request.headers.get("authorization") ?? "";
  // A Vercel envia "Bearer <CRON_SECRET>".
  const recebido = cabecalho.replace(/^Bearer\s+/i, "");
  return recebido.length > 0 && safeEquals(recebido, segredo);
}

export async function GET(request: Request) {
  if (!autorizado(request)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const inicio = Date.now();
  const restante = () => ORCAMENTO_MS - (Date.now() - inicio);

  const resultado = {
    backfill: { processados: 0, falhas: 0 },
    incremental: { processados: 0, falhas: 0 },
    interrompido: false,
  };

  // ---- 1. Fila de backfill ----
  while (restante() > 12_000) {
    const job = await prisma.syncJob.findFirst({
      where: { status: "PENDING", connection: { status: "ACTIVE" } },
      orderBy: { createdAt: "asc" },
    });

    if (!job) break;

    // Marca como consumido antes de rodar: se a funcao morrer no meio, o job
    // nao fica em loop eterno sendo pego de novo a cada execucao.
    await prisma.syncJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    });

    try {
      await syncConnectionRange(
        job.connectionId,
        fromUtcDate(job.rangeStart),
        fromUtcDate(job.rangeEnd),
      );
      // syncConnectionRange cria o proprio registro de execucao; este job da
      // fila ja cumpriu o papel de agendar o intervalo.
      await prisma.syncJob.update({
        where: { id: job.id },
        data: { status: "SUCCESS", finishedAt: new Date() },
      });
      resultado.backfill.processados++;
    } catch (error) {
      resultado.backfill.falhas++;
      await prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  // ---- 2. Janela recente de cada conexao ativa ----
  const conexoes = await prisma.connection.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ lastSyncedAt: { sort: "asc", nulls: "first" } }],
    select: { id: true },
  });

  for (const conexao of conexoes) {
    if (restante() < 12_000) {
      resultado.interrompido = true;
      break;
    }

    try {
      await syncConnectionIncremental(conexao.id);
      resultado.incremental.processados++;
    } catch {
      // O engine ja registrou o motivo na conexao e no SyncJob.
      resultado.incremental.falhas++;
    }
  }

  return NextResponse.json({
    ...resultado,
    duracaoMs: Date.now() - inicio,
  });
}
