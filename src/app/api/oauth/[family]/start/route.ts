/**
 * Inicia o consentimento OAuth de uma familia (Google, Meta...).
 *
 * GET /api/oauth/google/start?projeto=<slug>
 *
 * Pede de uma vez os escopos de TODAS as plataformas habilitadas da familia:
 * um unico consentimento do Google libera GA4, Ads e Search Console juntos, em
 * vez de mandar a pessoa autorizar tres vezes seguidas.
 */

import { NextResponse } from "next/server";

import { appUrl, oauthCallbackUrl } from "@/lib/urls";
import { prisma } from "@/lib/prisma";
import { getFamily, getFamilyClient } from "@/providers/families";
import { listProvidersByFamily, scopesForFamily } from "@/providers/registry";
import type { OAuthFamilyId } from "@/providers/types";
import { criarEstado } from "@/server/oauth/state";
import { exigirSessao } from "@/server/tenancy";

const FAMILIAS_SUPORTADAS = new Set(["google", "meta"]);

/**
 * Quais plataformas de cada familia entram no pedido de escopos.
 *
 * Pedir um escopo cuja API ainda nao foi ativada no Google Cloud faz a tela de
 * consentimento INTEIRA falhar - nao so aquela plataforma. Por isso a lista e
 * explicita e sai de variavel de ambiente: quando o acesso ao Meu Negocio for
 * aprovado, basta acrescentar google_business_profile e reimplantar.
 */
function plataformasHabilitadas(family: OAuthFamilyId): string[] {
  const configurado = process.env[`${family.toUpperCase()}_ENABLED_PROVIDERS`];

  if (configurado) {
    return configurado
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }

  // Padrao seguro: tudo menos o que ainda depende de liberacao manual do
  // provedor para a API sequer aparecer no console.
  return listProvidersByFamily(family)
    .filter((provider) => provider.id !== "google_business_profile")
    .map((provider) => provider.id);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ family: string }> },
) {
  const sessao = await exigirSessao();
  const { family } = await params;

  if (!FAMILIAS_SUPORTADAS.has(family)) {
    return NextResponse.json(
      { erro: `Família OAuth desconhecida: ${family}` },
      { status: 404 },
    );
  }

  const familyId = family as OAuthFamilyId;
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("projeto");

  if (!slug) {
    return NextResponse.json(
      { erro: "Informe o projeto na query string: ?projeto=<slug>" },
      { status: 400 },
    );
  }

  // Busca por slug MAIS organizationId: um slug de outra organizacao nao
  // pode virar destino de uma credencial nossa.
  const projeto = await prisma.project.findFirst({
    where: { slug, organizationId: sessao.organizationId, archivedAt: null },
    select: { id: true, slug: true },
  });

  if (!projeto) {
    return NextResponse.json(
      { erro: "Projeto não encontrado" },
      { status: 404 },
    );
  }

  let configuracao;
  try {
    const familia = getFamily(familyId);
    configuracao = { familia, ...getFamilyClient(familia) };
  } catch (error) {
    // App sem client id/secret configurado: erro de operacao, nao do usuario.
    return NextResponse.redirect(
      `${appUrl()}/projetos/${projeto.slug}?erro=${encodeURIComponent(
        error instanceof Error ? error.message : "Configuração ausente",
      )}`,
    );
  }

  const { familia, clientId } = configuracao;

  const escopos = scopesForFamily(familyId, plataformasHabilitadas(familyId));

  const estado = criarEstado({
    projectId: projeto.id,
    organizationId: sessao.organizationId,
    family: familyId,
    returnTo: `/projetos/${projeto.slug}`,
  });

  const autorizacao = new URL(familia.authorizeUrl);
  autorizacao.searchParams.set("client_id", clientId);
  autorizacao.searchParams.set("redirect_uri", oauthCallbackUrl(familyId));
  autorizacao.searchParams.set("response_type", "code");
  autorizacao.searchParams.set(
    "scope",
    escopos.join(familia.scopeSeparator),
  );
  autorizacao.searchParams.set("state", estado);

  for (const [chave, valor] of Object.entries(familia.extraAuthParams ?? {})) {
    autorizacao.searchParams.set(chave, valor);
  }

  return NextResponse.redirect(autorizacao.toString());
}
