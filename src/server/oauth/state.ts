/**
 * Parametro `state` do fluxo OAuth.
 *
 * O `state` volta do Google intacto, e e a unica coisa que liga o callback ao
 * pedido original. Se ele fosse um texto qualquer, um atacante poderia induzir
 * seu navegador a completar um consentimento que ELE iniciou, e a credencial
 * dele acabaria vinculada ao SEU projeto - o CSRF classico de OAuth.
 *
 * Por isso o state e assinado com HMAC-SHA256 e carrega validade curta. O
 * callback so aceita um state que ele mesmo emitiu e que ainda nao expirou.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const VALIDADE_MS = 15 * 60 * 1000; // 15 minutos

export interface EstadoOAuth {
  /** Projeto que recebera a conexao. */
  projectId: string;
  /** Organizacao dona do projeto, revalidada no callback. */
  organizationId: string;
  /** Familia OAuth: "google" | "meta" | ... */
  family: string;
  /** Para onde voltar depois de concluir. */
  returnTo: string;
  nonce: string;
  exp: number;
}

function segredo(): string {
  const valor = process.env.AUTH_SECRET;
  if (!valor) {
    throw new Error("AUTH_SECRET ausente: nao e possivel assinar o state OAuth");
  }
  return valor;
}

function assinar(dados: string): string {
  return createHmac("sha256", segredo()).update(dados).digest("base64url");
}

export function criarEstado(
  entrada: Omit<EstadoOAuth, "nonce" | "exp">,
): string {
  const estado: EstadoOAuth = {
    ...entrada,
    nonce: randomBytes(12).toString("base64url"),
    exp: Date.now() + VALIDADE_MS,
  };

  const corpo = Buffer.from(JSON.stringify(estado)).toString("base64url");
  return `${corpo}.${assinar(corpo)}`;
}

/** Devolve o estado quando a assinatura confere e nao expirou; senao, null. */
export function lerEstado(bruto: string | null): EstadoOAuth | null {
  if (!bruto) return null;

  const partes = bruto.split(".");
  if (partes.length !== 2) return null;

  const [corpo, assinaturaRecebida] = partes;
  const assinaturaEsperada = assinar(corpo);

  const a = Buffer.from(assinaturaRecebida);
  const b = Buffer.from(assinaturaEsperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const estado = JSON.parse(
      Buffer.from(corpo, "base64url").toString("utf8"),
    ) as EstadoOAuth;

    if (!estado.exp || estado.exp < Date.now()) return null;
    if (!estado.projectId || !estado.organizationId || !estado.family) {
      return null;
    }

    return estado;
  } catch {
    return null;
  }
}
