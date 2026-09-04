import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { listProvidersByFamily, tryGetProvider } from "@/providers/registry";
import type { ExternalAccount, OAuthFamilyId } from "@/providers/types";
import { getFreshAccessToken } from "@/server/oauth/tokens";
import { enqueueBackfill } from "@/server/sync/engine";
import { exigirSessao } from "@/server/tenancy";

export const metadata: Metadata = { robots: { index: false } };
export const dynamic = "force-dynamic";

const FAMILIAS = new Set(["google", "meta"]);

interface Descoberta {
  providerId: string;
  providerNome: string;
  cor: string;
  contas: ExternalAccount[];
  erro: string | null;
  aviso: string | null;
}

const registro = {
  info: (m: string, x?: unknown) => console.log(`[vincular] ${m}`, x ?? ""),
  warn: (m: string, x?: unknown) => console.warn(`[vincular] ${m}`, x ?? ""),
  error: (m: string, x?: unknown) => console.error(`[vincular] ${m}`, x ?? ""),
};

async function vincular(formData: FormData) {
  "use server";

  const sessao = await exigirSessao();
  const slug = String(formData.get("slug"));
  const providerId = String(formData.get("provider"));
  const credentialId = String(formData.get("credentialId"));
  const externalId = String(formData.get("externalId"));
  const externalName = String(formData.get("externalName"));
  const configBruta = String(formData.get("config") ?? "{}");

  const projeto = await prisma.project.findFirst({
    where: { slug, organizationId: sessao.organizationId },
    select: { id: true },
  });
  if (!projeto) redirect("/projetos?erro=Projeto não encontrado");

  // A credencial precisa ser da mesma organizacao, senao daria para vincular
  // o acesso de outra pessoa passando o id na mao.
  const credencial = await prisma.credential.findFirst({
    where: { id: credentialId, organizationId: sessao.organizationId },
    select: { id: true },
  });
  if (!credencial) redirect(`/projetos/${slug}?erro=Credencial inválida`);

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(configBruta) as Record<string, unknown>;
  } catch {
    config = {};
  }

  const conexao = await prisma.connection.upsert({
    where: {
      projectId_provider_externalId: {
        projectId: projeto.id,
        provider: providerId,
        externalId,
      },
    },
    create: {
      projectId: projeto.id,
      credentialId,
      provider: providerId,
      externalId,
      externalName,
      config: config as never,
      status: "ACTIVE",
    },
    update: {
      credentialId,
      externalName,
      config: config as never,
      status: "ACTIVE",
      lastError: null,
    },
  });

  // O historico e carregado em segundo plano, um mes por vez. Vincular uma
  // conta nao pode prender a tela por dois minutos.
  const blocos = await enqueueBackfill(conexao.id, 13);

  revalidatePath(`/projetos/${slug}`);
  redirect(
    `/projetos/${slug}?ok=${encodeURIComponent(
      `${externalName} vinculada. ${blocos} meses de histórico entraram na fila.`,
    )}`,
  );
}

export default async function Vincular({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ familia?: string }>;
}) {
  const sessao = await exigirSessao();
  const { slug } = await params;
  const { familia } = await searchParams;

  if (!familia || !FAMILIAS.has(familia)) {
    redirect(`/projetos/${slug}?erro=Família inválida`);
  }

  const familyId = familia as OAuthFamilyId;

  const projeto = await prisma.project.findFirst({
    where: { slug, organizationId: sessao.organizationId, archivedAt: null },
    include: {
      connections: { select: { provider: true, externalId: true } },
    },
  });
  if (!projeto) notFound();

  const credenciais = await prisma.credential.findMany({
    where: {
      organizationId: sessao.organizationId,
      family: familyId,
      revokedAt: null,
    },
    orderBy: { updatedAt: "desc" },
  });

  if (credenciais.length === 0) {
    redirect(`/projetos/${slug}?erro=Nenhuma autorização encontrada`);
  }

  // Usa a credencial autorizada mais recentemente.
  const credencial = credenciais[0];
  const jaVinculadas = new Set(
    projeto.connections.map((c) => `${c.provider}::${c.externalId}`),
  );

  let accessToken: string | null = null;
  let erroToken: string | null = null;
  try {
    accessToken = await getFreshAccessToken(credencial.id);
  } catch (error) {
    erroToken =
      error instanceof Error ? error.message : "Falha ao renovar o acesso";
  }

  const descobertas: Descoberta[] = [];

  if (accessToken) {
    const habilitados =
      process.env[`${familyId.toUpperCase()}_ENABLED_PROVIDERS`]
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? null;

    const provedores = listProvidersByFamily(familyId).filter(
      (p) =>
        (!habilitados || habilitados.includes(p.id)) &&
        p.id !== "google_business_profile",
    );

    // Sequencial de proposito: em paralelo, tres chamadas simultaneas por
    // credencial derrubam a cota antes de a pagina abrir.
    for (const provider of provedores) {
      try {
        const contas = await provider.listAccounts({
          accessToken,
          log: registro,
        });
        descobertas.push({
          providerId: provider.id,
          providerNome: provider.name,
          cor: provider.brandColor,
          contas,
          erro: null,
          aviso:
            contas.length === 0
              ? "Nenhuma conta visível para esta autorização."
              : null,
        });
      } catch (error) {
        // Uma plataforma sem liberação não pode derrubar as outras.
        descobertas.push({
          providerId: provider.id,
          providerNome: provider.name,
          cor: provider.brandColor,
          contas: [],
          erro:
            error instanceof Error ? error.message : "Falha ao listar contas",
          aviso: null,
        });
      }
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/projetos" className="marca">
            Métrica
          </Link>
          <span className="org">{projeto.name}</span>
        </div>
      </header>

      <main className="pagina">
        <p style={{ fontSize: "14px", marginBottom: "10px" }}>
          <Link href={`/projetos/${projeto.slug}`}>← {projeto.name}</Link>
        </p>

        <div className="pagina-head">
          <div>
            <h1>Escolher contas</h1>
            <p>
              Autorizado como{" "}
              <strong>{credencial.email ?? credencial.displayName}</strong>.
              Vincule as contas deste cliente.
            </p>
          </div>
        </div>

        {erroToken ? <p className="alert">{erroToken}</p> : null}

        {descobertas.map((descoberta) => (
          <section key={descoberta.providerId} style={{ marginBottom: "30px" }}>
            <h2 className="titulo-provider">
              <span
                className="conexao-cor"
                aria-hidden="true"
                style={{ background: descoberta.cor }}
              />
              {descoberta.providerNome}
            </h2>

            {descoberta.erro ? (
              <p className="alert">{descoberta.erro}</p>
            ) : descoberta.aviso ? (
              <p
                style={{
                  color: "var(--muted)",
                  fontSize: "14.5px",
                  margin: 0,
                }}
              >
                {descoberta.aviso}
              </p>
            ) : (
              <ul className="lista-conexoes">
                {descoberta.contas.map((conta) => {
                  const chave = `${descoberta.providerId}::${conta.externalId}`;
                  const vinculada = jaVinculadas.has(chave);

                  return (
                    <li key={chave} className="conexao">
                      <div className="conexao-info">
                        <span className="conexao-nome">{conta.name}</span>
                        <span className="conexao-meta">
                          {conta.group ? `${conta.group} · ` : ""}
                          <code style={{ fontSize: "12.5px" }}>
                            {conta.externalId}
                          </code>
                        </span>
                      </div>

                      <div className="conexao-acoes">
                        {vinculada ? (
                          <span
                            style={{
                              fontSize: "13.5px",
                              color: "var(--positive)",
                            }}
                          >
                            Já vinculada
                          </span>
                        ) : conta.selectable === false ? (
                          <span
                            style={{
                              fontSize: "13.5px",
                              color: "var(--muted)",
                            }}
                          >
                            Administradora — sem métricas próprias
                          </span>
                        ) : (
                          <form action={vincular}>
                            <input type="hidden" name="slug" value={projeto.slug} />
                            <input
                              type="hidden"
                              name="provider"
                              value={descoberta.providerId}
                            />
                            <input
                              type="hidden"
                              name="credentialId"
                              value={credencial.id}
                            />
                            <input
                              type="hidden"
                              name="externalId"
                              value={conta.externalId}
                            />
                            <input
                              type="hidden"
                              name="externalName"
                              value={conta.name}
                            />
                            <input
                              type="hidden"
                              name="config"
                              value={JSON.stringify(conta.config ?? {})}
                            />
                            <button type="submit" className="btn pequeno">
                              Vincular
                            </button>
                          </form>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </main>
    </>
  );
}
