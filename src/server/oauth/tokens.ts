/**
 * Ciclo de vida dos tokens OAuth.
 *
 * Regra da casa: nenhum outro arquivo le Credential.accessToken diretamente.
 * Todo mundo pede `getFreshAccessToken(credentialId)`, que devolve um token
 * valido - renovando antes de vencer, se preciso - e ja descriptografado.
 *
 * As duas familias se comportam de formas diferentes:
 *
 *   Google - tem refresh_token de verdade. Renovacao silenciosa e ilimitada,
 *            desde que o usuario nao revogue o acesso.
 *   Meta   - NAO tem refresh_token. O token curto do callback e trocado por um
 *            de longa duracao (~60 dias). Perto do vencimento tentamos trocar
 *            de novo; quando o Meta recusa, so resta pedir nova autorizacao.
 */

import type { Credential } from "@prisma/client";

import { decrypt, encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { getFamily, getFamilyClient } from "@/providers/families";
import type { OAuthFamilyId } from "@/providers/types";

/** Renova quando faltar menos que isso para expirar. */
const REFRESH_WINDOW_MS = 5 * 60 * 1000; // 5 minutos
/** O Meta so consegue estender tokens de longa duracao com folga. */
const META_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

/** Credencial invalida de forma permanente: exige nova autorizacao humana. */
export class ReauthRequiredError extends Error {
  readonly credentialId: string;
  constructor(credentialId: string, message: string) {
    super(message);
    this.name = "ReauthRequiredError";
    this.credentialId = credentialId;
  }
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  token_type?: string;
  error?: unknown;
  error_description?: string;
}

function refreshWindowFor(family: OAuthFamilyId): number {
  return family === "meta" ? META_REFRESH_WINDOW_MS : REFRESH_WINDOW_MS;
}

function needsRefresh(credential: Credential): boolean {
  if (!credential.expiresAt) return false; // token sem validade declarada
  const window = refreshWindowFor(credential.family as OAuthFamilyId);
  return credential.expiresAt.getTime() - Date.now() < window;
}

/**
 * Devolve um access token valido, renovando se necessario.
 * Lanca ReauthRequiredError quando a renovacao nao e mais possivel.
 */
export async function getFreshAccessToken(
  credentialId: string,
): Promise<string> {
  const credential = await prisma.credential.findUnique({
    where: { id: credentialId },
  });

  if (!credential) {
    throw new Error(`Credencial ${credentialId} nao encontrada`);
  }
  if (credential.revokedAt) {
    throw new ReauthRequiredError(
      credentialId,
      "Acesso revogado. Refaca a conexao.",
    );
  }

  if (!needsRefresh(credential)) {
    return decrypt(credential.accessToken);
  }

  const familyId = credential.family as OAuthFamilyId;
  return familyId === "meta"
    ? extendMetaToken(credential)
    : refreshWithRefreshToken(credential);
}

/** Fluxo padrao OAuth2 (Google, LinkedIn). */
async function refreshWithRefreshToken(credential: Credential): Promise<string> {
  if (!credential.refreshToken) {
    throw new ReauthRequiredError(
      credential.id,
      "Credencial sem refresh token. Refaca a conexao.",
    );
  }

  const family = getFamily(credential.family as OAuthFamilyId);
  const { clientId, clientSecret } = getFamilyClient(family);

  const res = await fetch(family.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: decrypt(credential.refreshToken),
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const data = (await res.json()) as TokenResponse;

  if (!res.ok || !data.access_token) {
    // invalid_grant = usuario revogou, trocou a senha ou o token expirou de vez.
    await markRevoked(credential.id);
    throw new ReauthRequiredError(
      credential.id,
      `Renovacao recusada por ${family.name}: ${data.error_description ?? JSON.stringify(data.error ?? {})}`,
    );
  }

  return persistToken(credential.id, data);
}

/** O Meta "renova" trocando um token de longa duracao por outro. */
async function extendMetaToken(credential: Credential): Promise<string> {
  const family = getFamily("meta");
  const { clientId, clientSecret } = getFamilyClient(family);

  const url = new URL(family.tokenUrl);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("fb_exchange_token", decrypt(credential.accessToken));

  const res = await fetch(url.toString());
  const data = (await res.json()) as TokenResponse;

  if (!res.ok || !data.access_token) {
    await markRevoked(credential.id);
    throw new ReauthRequiredError(
      credential.id,
      "O Meta nao renovou o token (limite de 60 dias). Refaca a conexao.",
    );
  }

  return persistToken(credential.id, data);
}

/**
 * Troca o `code` do callback pelo primeiro par de tokens.
 * Usado pelo endpoint de callback OAuth.
 */
export async function exchangeCodeForTokens(
  familyId: OAuthFamilyId,
  code: string,
  redirectUri: string,
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}> {
  const family = getFamily(familyId);
  const { clientId, clientSecret } = getFamilyClient(family);

  const res = await fetch(family.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  const data = (await res.json()) as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Troca de codigo falhou em ${family.name}: ${data.error_description ?? JSON.stringify(data.error ?? data)}`,
    );
  }

  let accessToken = data.access_token;
  let expiresIn = data.expires_in ?? null;

  // O Meta devolve um token de ~1h no callback. Trocamos imediatamente por um
  // de longa duracao, senao a conexao morre no mesmo dia.
  if (familyId === "meta") {
    const longLived = await exchangeMetaForLongLived(accessToken);
    accessToken = longLived.accessToken;
    expiresIn = longLived.expiresIn;
  }

  return {
    accessToken,
    refreshToken: data.refresh_token ?? null,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
  };
}

async function exchangeMetaForLongLived(
  shortLivedToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const family = getFamily("meta");
  const { clientId, clientSecret } = getFamilyClient(family);

  const url = new URL(family.tokenUrl);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("fb_exchange_token", shortLivedToken);

  const res = await fetch(url.toString());
  const data = (await res.json()) as TokenResponse;

  if (!res.ok || !data.access_token) {
    throw new Error(
      `Meta recusou a troca por token de longa duracao: ${JSON.stringify(data.error ?? data)}`,
    );
  }

  // O Meta as vezes omite expires_in em token de longa duracao; 60 dias e o padrao.
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 60 * 24 * 60 * 60,
  };
}

async function persistToken(
  credentialId: string,
  data: TokenResponse,
): Promise<string> {
  const accessToken = data.access_token!;

  await prisma.credential.update({
    where: { id: credentialId },
    data: {
      accessToken: encrypt(accessToken),
      // O Google so reenvia refresh_token quando ele muda; preservamos o antigo.
      ...(data.refresh_token
        ? { refreshToken: encrypt(data.refresh_token) }
        : {}),
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null,
      revokedAt: null,
    },
  });

  return accessToken;
}

async function markRevoked(credentialId: string): Promise<void> {
  await prisma.$transaction([
    prisma.credential.update({
      where: { id: credentialId },
      data: { revokedAt: new Date() },
    }),
    prisma.connection.updateMany({
      where: { credentialId },
      data: { status: "NEEDS_REAUTH" },
    }),
  ]);
}
