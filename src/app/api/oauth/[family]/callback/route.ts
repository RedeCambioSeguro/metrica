/**
 * Recebe o retorno do consentimento OAuth e grava a credencial.
 *
 * GET /api/oauth/google/callback?code=...&state=...
 *
 * Este endereco precisa estar cadastrado, identico, no painel do provedor.
 * Ele e montado por oauthCallbackUrl(), a partir de APP_URL.
 */

import { NextResponse } from "next/server";

import { encrypt, encryptNullable } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { appUrl, oauthCallbackUrl } from "@/lib/urls";
import { getFamily } from "@/providers/families";
import type { OAuthFamilyId } from "@/providers/types";
import { exchangeCodeForTokens } from "@/server/oauth/tokens";
import { lerEstado } from "@/server/oauth/state";
import { exigirSessao } from "@/server/tenancy";

const FAMILIAS_SUPORTADAS = new Set(["google", "meta"]);

function voltarComErro(destino: string, mensagem: string) {
  const url = new URL(destino, appUrl());
  url.searchParams.set("erro", mensagem);
  return NextResponse.redirect(url.toString());
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ family: string }> },
) {
  const sessao = await exigirSessao();
  const { family } = await params;

  if (!FAMILIAS_SUPORTADAS.has(family)) {
    return NextResponse.json({ erro: "Família desconhecida" }, { status: 404 });
  }

  const familyId = family as OAuthFamilyId;
  const { searchParams } = new URL(request.url);

  // O provedor avisa aqui quando a pessoa clicou em "cancelar".
  const erroProvedor =
    searchParams.get("error_description") ?? searchParams.get("error");
  const estado = lerEstado(searchParams.get("state"));

  // Sem state valido nao ha para onde voltar com seguranca.
  const destino = estado?.returnTo ?? "/projetos";

  if (erroProvedor) {
    return voltarComErro(
      destino,
      erroProvedor === "access_denied"
        ? "Autorização cancelada."
        : `O provedor recusou: ${erroProvedor}`,
    );
  }

  if (!estado) {
    return voltarComErro(
      "/projetos",
      "A autorização expirou ou o retorno não pôde ser validado. Tente de novo.",
    );
  }

  // O state e assinado, mas quem esta logado agora pode ser outra pessoa:
  // confirmar a organizacao impede que a credencial caia no projeto errado.
  if (estado.organizationId !== sessao.organizationId) {
    return voltarComErro("/projetos", "Autorização pertence a outra conta.");
  }

  if (estado.family !== familyId) {
    return voltarComErro(destino, "Retorno em rota de provedor divergente.");
  }

  const code = searchParams.get("code");
  if (!code) {
    return voltarComErro(destino, "O provedor não devolveu o código de acesso.");
  }

  try {
    const tokens = await exchangeCodeForTokens(
      familyId,
      code,
      oauthCallbackUrl(familyId),
    );

    const familia = getFamily(familyId);
    const identidade = await familia.fetchIdentity(tokens.accessToken);

    // Sem refresh token no Google, a conexao morre em uma hora. Acontece
    // quando a pessoa ja autorizou antes e o Google nao reenvia o token;
    // e por isso que pedimos prompt=consent no start.
    if (familyId === "google" && !tokens.refreshToken) {
      const existente = await prisma.credential.findUnique({
        where: {
          organizationId_family_providerUserId: {
            organizationId: sessao.organizationId,
            family: familyId,
            providerUserId: identidade.providerUserId,
          },
        },
        select: { refreshToken: true },
      });

      if (!existente?.refreshToken) {
        return voltarComErro(
          destino,
          "O Google não devolveu a permissão de longa duração. Remova o acesso em myaccount.google.com/permissions e autorize novamente.",
        );
      }
    }

    await prisma.credential.upsert({
      where: {
        organizationId_family_providerUserId: {
          organizationId: sessao.organizationId,
          family: familyId,
          providerUserId: identidade.providerUserId,
        },
      },
      create: {
        organizationId: sessao.organizationId,
        family: familyId,
        providerUserId: identidade.providerUserId,
        displayName: identidade.displayName,
        email: identidade.email,
        accessToken: encrypt(tokens.accessToken),
        refreshToken: encryptNullable(tokens.refreshToken),
        expiresAt: tokens.expiresAt,
      },
      update: {
        displayName: identidade.displayName,
        email: identidade.email,
        accessToken: encrypt(tokens.accessToken),
        // Preserva o refresh token antigo quando o provedor nao reenvia.
        ...(tokens.refreshToken
          ? { refreshToken: encrypt(tokens.refreshToken) }
          : {}),
        expiresAt: tokens.expiresAt,
        revokedAt: null,
      },
    });

    // Reautorizacao de uma credencial que estava quebrada: reabilita as
    // conexoes que dependiam dela.
    await prisma.connection.updateMany({
      where: {
        credential: {
          organizationId: sessao.organizationId,
          family: familyId,
          providerUserId: identidade.providerUserId,
        },
        status: "NEEDS_REAUTH",
      },
      data: { status: "ACTIVE", lastError: null },
    });

    const sucesso = new URL(`${destino}/vincular`, appUrl());
    sucesso.searchParams.set("familia", familyId);
    return NextResponse.redirect(sucesso.toString());
  } catch (error) {
    console.error("[oauth] callback falhou", error);
    return voltarComErro(
      destino,
      error instanceof Error ? error.message : "Falha ao concluir a autorização.",
    );
  }
}
