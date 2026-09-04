/**
 * Familias OAuth.
 *
 * Uma familia = um consentimento. Um unico login do Google ja concede acesso a
 * GA4, Google Ads, Search Console e Meu Negocio de uma vez, entao guardamos UMA
 * credencial por familia e reaproveitamos entre varias conexoes. Isso evita
 * pedir ao cliente que autorize quatro vezes seguidas.
 */

import type { OAuthFamilyId } from "./types";

export interface OAuthFamily {
  id: OAuthFamilyId;
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** Escopos concedidos sempre, independente do provider escolhido. */
  baseScopes: string[];
  /** Separador de escopos na querystring (Google usa espaco, Meta usa virgula). */
  scopeSeparator: string;
  /** Parametros extras no authorize. */
  extraAuthParams?: Record<string, string>;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Descobre quem autorizou, para nomear a credencial e evitar duplicatas. */
  fetchIdentity(accessToken: string): Promise<{
    providerUserId: string;
    displayName?: string;
    email?: string;
  }>;
}

export const OAUTH_FAMILIES: Record<OAuthFamilyId, OAuthFamily> = {
  google: {
    id: "google",
    name: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    baseScopes: [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
    scopeSeparator: " ",
    extraAuthParams: {
      // Sem estes dois o Google devolve refresh_token apenas na PRIMEIRA
      // autorizacao. Como precisamos sincronizar para sempre, forcamos o
      // consentimento a cada vinculo para garantir o refresh_token.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    },
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    async fetchIdentity(accessToken) {
      const res = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) {
        throw new Error(`Google userinfo falhou: ${res.status} ${await res.text()}`);
      }
      const data = (await res.json()) as {
        sub: string;
        name?: string;
        email?: string;
      };
      return {
        providerUserId: data.sub,
        displayName: data.name,
        email: data.email,
      };
    },
  },

  meta: {
    id: "meta",
    name: "Meta",
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    baseScopes: ["public_profile"],
    scopeSeparator: ",",
    clientIdEnv: "META_APP_ID",
    clientSecretEnv: "META_APP_SECRET",
    async fetchIdentity(accessToken) {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`,
      );
      if (!res.ok) {
        throw new Error(`Meta /me falhou: ${res.status} ${await res.text()}`);
      }
      const data = (await res.json()) as {
        id: string;
        name?: string;
        email?: string;
      };
      return {
        providerUserId: data.id,
        displayName: data.name,
        email: data.email,
      };
    },
  },

  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    baseScopes: ["openid", "profile", "email"],
    scopeSeparator: " ",
    clientIdEnv: "LINKEDIN_CLIENT_ID",
    clientSecretEnv: "LINKEDIN_CLIENT_SECRET",
    async fetchIdentity(accessToken) {
      const res = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`LinkedIn userinfo falhou: ${res.status}`);
      }
      const data = (await res.json()) as {
        sub: string;
        name?: string;
        email?: string;
      };
      return {
        providerUserId: data.sub,
        displayName: data.name,
        email: data.email,
      };
    },
  },

  tiktok: {
    id: "tiktok",
    name: "TikTok",
    authorizeUrl: "https://business-api.tiktok.com/portal/auth",
    tokenUrl:
      "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
    baseScopes: [],
    scopeSeparator: ",",
    clientIdEnv: "TIKTOK_APP_ID",
    clientSecretEnv: "TIKTOK_APP_SECRET",
    async fetchIdentity(accessToken) {
      const res = await fetch(
        "https://business-api.tiktok.com/open_api/v1.3/user/info/",
        { headers: { "Access-Token": accessToken } },
      );
      if (!res.ok) throw new Error(`TikTok user/info falhou: ${res.status}`);
      const data = (await res.json()) as {
        data?: { core_user_id?: string; display_name?: string; email?: string };
      };
      return {
        providerUserId: String(data.data?.core_user_id ?? ""),
        displayName: data.data?.display_name,
        email: data.data?.email,
      };
    },
  },
};

export function getFamily(id: OAuthFamilyId): OAuthFamily {
  const family = OAUTH_FAMILIES[id];
  if (!family) throw new Error(`Familia OAuth desconhecida: ${id}`);
  return family;
}

export function getFamilyClient(family: OAuthFamily): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env[family.clientIdEnv];
  const clientSecret = process.env[family.clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new Error(
      `Credenciais do app ${family.name} ausentes: defina ${family.clientIdEnv} e ${family.clientSecretEnv} no .env`,
    );
  }
  return { clientId, clientSecret };
}
