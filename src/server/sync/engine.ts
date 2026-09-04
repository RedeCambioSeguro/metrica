/**
 * Motor de sincronizacao.
 *
 * Responsabilidade unica: pegar os pontos que um provider devolveu e grava-los
 * em MetricDaily de forma idempotente. Todo o resto - autenticacao, formato da
 * API, quais metricas existem - e problema do provider.
 *
 * Por que apagar e reinserir o intervalo, em vez de dar upsert linha a linha:
 *   - upsert de 20 mil linhas e lento e nao remove o que sumiu (uma pagina que
 *     caiu do top 25 continuaria no banco para sempre, inflando o relatorio);
 *   - apagar o intervalo e reinserir deixa o banco identico ao que a API diz
 *     agora, que e a definicao de "sincronizado".
 *
 * Por que re-sincronizar dias ja coletados (SYNC_LOOKBACK_DAYS):
 *   Google e Meta ajustam numeros retroativamente - conversoes tardias, cliques
 *   invalidos estornados, dados do Search Console que so ficam completos depois
 *   de tres dias. Puxar so "ontem" congela numeros errados no relatorio.
 */

import { Prisma } from "@prisma/client";

import { addDays, chunkRange, todayIn, toUtcDate, type IsoDate } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { AuthError, RateLimitError } from "@/providers/http";
import { getProvider } from "@/providers/registry";
import type { MetricPoint, ProviderLogger } from "@/providers/types";
import { dimensionKey } from "@/server/metrics/key";
import { getFreshAccessToken, ReauthRequiredError } from "@/server/oauth/tokens";

const DEFAULT_LOOKBACK_DAYS = Number(process.env.SYNC_LOOKBACK_DAYS ?? "7");
/** Maximo de dias por job. Acima disso o serverless estoura o tempo limite. */
const MAX_DAYS_PER_JOB = 31;

export interface SyncResult {
  connectionId: string;
  rangeStart: IsoDate;
  rangeEnd: IsoDate;
  rowsWritten: number;
}

function createLogger(prefix: string): ProviderLogger {
  return {
    info: (message, meta) => console.log(`[sync:${prefix}] ${message}`, meta ?? ""),
    warn: (message, meta) => console.warn(`[sync:${prefix}] ${message}`, meta ?? ""),
    error: (message, meta) => console.error(`[sync:${prefix}] ${message}`, meta ?? ""),
  };
}

/**
 * Converte pontos do provider em linhas do banco, resolvendo colisoes.
 *
 * Um provider pode emitir a mesma (data, metrica, dimensao) mais de uma vez -
 * por exemplo quando dois action_types do Meta mapeiam para "leads". Somamos,
 * porque essa e a semantica correta nesse caso; o createMany rejeitaria as
 * duplicatas de qualquer forma.
 */
function pointsToRows(
  connectionId: string,
  points: MetricPoint[],
): Prisma.MetricDailyCreateManyInput[] {
  const merged = new Map<string, Prisma.MetricDailyCreateManyInput>();

  for (const point of points) {
    if (!point.date || !point.metric) continue;
    if (!Number.isFinite(point.value)) continue;

    const dimKey = dimensionKey(point.dimensions);
    const mapKey = `${point.date}|${point.metric}|${dimKey}`;
    const existing = merged.get(mapKey);

    if (existing) {
      existing.value = new Prisma.Decimal(existing.value as Prisma.Decimal).plus(
        point.value,
      );
      continue;
    }

    merged.set(mapKey, {
      connectionId,
      date: toUtcDate(point.date),
      metric: point.metric,
      value: new Prisma.Decimal(point.value),
      dimensions: (point.dimensions ?? {}) as Prisma.InputJsonValue,
      dimensionKey: dimKey,
    });
  }

  return [...merged.values()];
}

/**
 * Sincroniza UM intervalo de UMA conexao. E a unidade de trabalho do sistema:
 * curta o bastante para caber no tempo limite de uma funcao serverless.
 */
export async function syncConnectionRange(
  connectionId: string,
  rangeStart: IsoDate,
  rangeEnd: IsoDate,
): Promise<SyncResult> {
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
    include: { project: true },
  });

  if (!connection) throw new Error(`Conexao ${connectionId} nao encontrada`);
  if (connection.status === "DISABLED") {
    throw new Error(`Conexao ${connectionId} esta desativada`);
  }

  const provider = getProvider(connection.provider);
  const log = createLogger(`${connection.provider}:${connection.id.slice(0, 6)}`);

  const job = await prisma.syncJob.create({
    data: {
      connectionId,
      rangeStart: toUtcDate(rangeStart),
      rangeEnd: toUtcDate(rangeEnd),
      status: "RUNNING",
      startedAt: new Date(),
      attempts: 1,
    },
  });

  try {
    const accessToken = await getFreshAccessToken(connection.credentialId);

    const points = await provider.sync({
      accessToken,
      connection: {
        id: connection.id,
        externalId: connection.externalId,
        externalName: connection.externalName,
        config: (connection.config ?? {}) as Record<string, unknown>,
      },
      rangeStart,
      rangeEnd,
      timezone: connection.project.timezone,
      log,
    });

    const rows = pointsToRows(connection.id, points);

    // Apagar + inserir dentro da mesma transacao: ou o intervalo inteiro fica
    // atualizado, ou nada muda. Nunca um relatorio com metade dos dias vazios.
    await prisma.$transaction(
      async (tx) => {
        await tx.metricDaily.deleteMany({
          where: {
            connectionId: connection.id,
            date: { gte: toUtcDate(rangeStart), lte: toUtcDate(rangeEnd) },
          },
        });

        // Lotes de 5 mil: o Postgres tem limite de parametros por comando.
        for (let i = 0; i < rows.length; i += 5000) {
          await tx.metricDaily.createMany({
            data: rows.slice(i, i + 5000),
            skipDuplicates: true,
          });
        }
      },
      { timeout: 120_000 },
    );

    await prisma.$transaction([
      prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCESS",
          finishedAt: new Date(),
          rowsWritten: rows.length,
        },
      }),
      prisma.connection.update({
        where: { id: connection.id },
        data: {
          lastSyncedAt: new Date(),
          lastError: null,
          status: "ACTIVE",
        },
      }),
    ]);

    log.info(`${rows.length} linhas gravadas`, { rangeStart, rangeEnd });

    return {
      connectionId: connection.id,
      rangeStart,
      rangeEnd,
      rowsWritten: rows.length,
    };
  } catch (error) {
    await handleSyncFailure(job.id, connection.id, error, log);
    throw error;
  }
}

async function handleSyncFailure(
  jobId: string,
  connectionId: string,
  error: unknown,
  log: ProviderLogger,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  log.error("falhou", message);

  // Token morto: so uma pessoa consegue resolver, reautorizando.
  if (error instanceof ReauthRequiredError || error instanceof AuthError) {
    await prisma.$transaction([
      prisma.syncJob.update({
        where: { id: jobId },
        data: { status: "FAILED", finishedAt: new Date(), error: message },
      }),
      prisma.connection.update({
        where: { id: connectionId },
        data: { status: "NEEDS_REAUTH", lastError: message },
      }),
    ]);
    return;
  }

  // Cota estourada: nao e culpa da conexao. Volta para a fila.
  if (error instanceof RateLimitError) {
    await prisma.$transaction([
      prisma.syncJob.update({
        where: { id: jobId },
        data: { status: "PENDING", startedAt: null, error: message },
      }),
      prisma.connection.update({
        where: { id: connectionId },
        data: { lastError: message },
      }),
    ]);
    return;
  }

  await prisma.$transaction([
    prisma.syncJob.update({
      where: { id: jobId },
      data: { status: "FAILED", finishedAt: new Date(), error: message },
    }),
    prisma.connection.update({
      where: { id: connectionId },
      data: { status: "ERROR", lastError: message },
    }),
  ]);
}

/**
 * Sync incremental: a janela recente, para capturar ajustes retroativos.
 * E o que roda no cron diario.
 */
export async function syncConnectionIncremental(
  connectionId: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<SyncResult> {
  const connection = await prisma.connection.findUniqueOrThrow({
    where: { id: connectionId },
    include: { project: { select: { timezone: true } } },
  });

  const today = todayIn(connection.project.timezone);
  return syncConnectionRange(connectionId, addDays(today, -lookbackDays), today);
}

/**
 * Backfill historico. Nao executa nada: enfileira um SyncJob por mes, que o
 * worker consome aos poucos. Vincular uma conta nova nao pode travar a tela
 * do usuario por dois minutos.
 */
export async function enqueueBackfill(
  connectionId: string,
  months = 13,
): Promise<number> {
  const connection = await prisma.connection.findUniqueOrThrow({
    where: { id: connectionId },
    include: { project: { select: { timezone: true } } },
  });

  const today = todayIn(connection.project.timezone);
  const start = addDays(today, -Math.round(months * 30.44));
  const chunks = chunkRange(start, today, MAX_DAYS_PER_JOB);

  await prisma.syncJob.createMany({
    data: chunks.map((chunk) => ({
      connectionId,
      rangeStart: toUtcDate(chunk.start),
      rangeEnd: toUtcDate(chunk.end),
      status: "PENDING" as const,
    })),
  });

  return chunks.length;
}
