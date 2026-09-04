/**
 * Endereco publico da aplicacao.
 *
 * Existem dois casos e eles pedem tratamentos opostos:
 *
 *   Login (Auth.js) - deduz o endereco pelo cabecalho da requisicao, gracas a
 *   `trustHost: true`. Assim funciona em producao, em localhost e nos deploys
 *   de preview, que tem URL diferente a cada branch.
 *
 *   OAuth das plataformas - NAO pode deduzir. O `redirect_uri` enviado ao
 *   Google e ao Meta precisa ser exatamente igual ao que foi cadastrado no
 *   painel deles; um endereco de preview deduzido do cabecalho nao esta
 *   cadastrado e o consentimento falha com redirect_uri_mismatch. Por isso
 *   este valor vem de APP_URL, fixo e explicito.
 */

function normalizar(url: string): string {
  // Barra no fim quebra a comparacao exata que Google e Meta fazem.
  return url.trim().replace(/\/+$/, "");
}

export function appUrl(): string {
  const explicito = process.env.APP_URL;
  if (explicito) return normalizar(explicito);

  // Sem APP_URL, cai para o endereco do deploy da Vercel. Serve para nao
  // quebrar em preview, mas o OAuth so funciona com APP_URL definida.
  if (process.env.VERCEL_URL) {
    return `https://${normalizar(process.env.VERCEL_URL)}`;
  }

  return "http://localhost:3000";
}

/** URI de retorno registrada no painel do provedor. */
export function oauthCallbackUrl(family: string): string {
  return `${appUrl()}/api/oauth/${family}/callback`;
}
