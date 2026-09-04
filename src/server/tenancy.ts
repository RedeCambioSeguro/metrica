/**
 * Isolamento entre organizacoes.
 *
 * Toda consulta que toca dados de cliente passa por aqui. A regra e simples e
 * nao tem excecao: nenhuma consulta busca por id sozinho - sempre por id MAIS
 * organizationId. Assim, trocar o id na URL nao revela o projeto de outra
 * organizacao, que e a falha classica de plataforma multi-cliente.
 */

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface SessaoAtual {
  userId: string;
  organizationId: string;
  role: string;
  nome: string | null;
  email: string;
}

/** Exige login. Redireciona para /entrar quando nao ha sessao valida. */
export async function exigirSessao(): Promise<SessaoAtual> {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/entrar");
  }

  if (!session.user.organizationId) {
    // Usuario autenticado mas sem organizacao: estado invalido, so acontece se
    // o vinculo foi apagado a mao no banco.
    redirect("/entrar?erro=sem-organizacao");
  }

  return {
    userId: session.user.id,
    organizationId: session.user.organizationId,
    role: session.user.role ?? "MEMBER",
    nome: session.user.name ?? null,
    email: session.user.email ?? "",
  };
}

/** Busca um projeto garantindo que ele pertence a organizacao da sessao. */
export async function buscarProjeto(slug: string, organizationId: string) {
  return prisma.project.findFirst({
    where: { slug, organizationId, archivedAt: null },
    include: {
      connections: {
        orderBy: { createdAt: "asc" },
        include: {
          credential: {
            select: { id: true, displayName: true, email: true, revokedAt: true },
          },
        },
      },
    },
  });
}

/** Idem para conexao: nunca busque so por connectionId. */
export async function buscarConexao(
  connectionId: string,
  organizationId: string,
) {
  return prisma.connection.findFirst({
    where: { id: connectionId, project: { organizationId } },
    include: { project: true, credential: true },
  });
}

/** Faixa Unicode dos acentos que o normalize("NFD") separa das letras. */
const ACENTO_COMBINANTE_INICIO = 0x0300;
const ACENTO_COMBINANTE_FIM = 0x036f;

/**
 * Gera um slug de URL a partir do nome do cliente.
 * "Ótica São Paulo" -> "otica-sao-paulo"
 */
export function gerarSlug(nome: string): string {
  const semAcento = [...nome.normalize("NFD")]
    .filter((caractere) => {
      const codigo = caractere.codePointAt(0) ?? 0;
      return (
        codigo < ACENTO_COMBINANTE_INICIO || codigo > ACENTO_COMBINANTE_FIM
      );
    })
    .join("");

  return semAcento
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Acrescenta sufixo numerico ate o slug ficar unico dentro da organizacao. */
export async function slugDisponivel(
  base: string,
  organizationId: string,
): Promise<string> {
  let candidato = base || "cliente";
  let sufixo = 2;

  while (
    await prisma.project.findFirst({
      where: { slug: candidato, organizationId },
      select: { id: true },
    })
  ) {
    candidato = `${base}-${sufixo}`;
    sufixo++;
  }

  return candidato;
}
