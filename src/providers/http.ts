/**
 * Cliente HTTP compartilhado pelos providers.
 *
 * As APIs de anuncios falham de formas previsiveis: 401 quando o token expirou,
 * 429 quando estouramos a cota, 5xx intermitente. Tratar isso aqui evita que
 * cada provider reinvente o mesmo retry.
 */

/** Token invalido/expirado: o motor de sync marca a conexao como NEEDS_REAUTH. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Cota estourada: o job volta para a fila em vez de ser marcado como falha. */
export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds = 60) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ProviderApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "ProviderApiError";
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions extends RequestInit {
  /** Rotulo usado nas mensagens de erro, ex.: "GA4 runReport". */
  label: string;
  /** Tentativas totais em erro transitorio (429/5xx). */
  maxAttempts?: number;
}

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function apiFetch<T>(
  url: string,
  options: RequestOptions,
): Promise<T> {
  const { label, maxAttempts = 3, ...init } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (cause) {
      // Erro de rede: vale a pena tentar de novo.
      lastError = cause;
      if (attempt === maxAttempts) {
        throw new ProviderApiError(
          `${label}: falha de rede apos ${attempt} tentativas`,
          0,
          String(cause),
        );
      }
      await sleep(500 * 2 ** (attempt - 1));
      continue;
    }

    if (res.ok) {
      const text = await res.text();
      if (!text) return undefined as T;
      return JSON.parse(text) as T;
    }

    const body = await res.text();

    if (res.status === 401 || res.status === 403) {
      // 403 nem sempre e auth (pode ser cota ou permissao de conta), mas as
      // mensagens do Google diferenciam pelo corpo.
      const looksLikeQuota = /quota|rateLimit|userRateLimit/i.test(body);
      if (res.status === 401 || !looksLikeQuota) {
        throw new AuthError(`${label}: ${res.status} - ${truncate(body)}`);
      }
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "60");
      throw new RateLimitError(
        `${label}: cota estourada - ${truncate(body)}`,
        Number.isFinite(retryAfter) ? retryAfter : 60,
      );
    }

    if (TRANSIENT_STATUSES.has(res.status) && attempt < maxAttempts) {
      await sleep(500 * 2 ** (attempt - 1));
      lastError = new ProviderApiError(label, res.status, body);
      continue;
    }

    throw new ProviderApiError(
      `${label}: ${res.status} - ${truncate(body)}`,
      res.status,
      body,
    );
  }

  throw lastError instanceof Error
    ? lastError
    : new ProviderApiError(`${label}: falhou`, 0, String(lastError));
}

export function postJson<T>(
  url: string,
  accessToken: string,
  body: unknown,
  label: string,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  return apiFetch<T>(url, {
    label,
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

export function getJson<T>(
  url: string,
  accessToken: string,
  label: string,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  return apiFetch<T>(url, {
    label,
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...extraHeaders,
    },
  });
}

function truncate(text: string, max = 400): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
