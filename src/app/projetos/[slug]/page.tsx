import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { tryGetProvider } from "@/providers/registry";
import { syncConnectionIncremental } from "@/server/sync/engine";
import { buscarProjeto, exigirSessao } from "@/server/tenancy";

export const metadata: Metadata = { robots: { index: false } };
export const dynamic = "force-dynamic";

const ROTULO_STATUS: Record<string, { texto: string; cor: string }> = {
  ACTIVE: { texto: "Ativa", cor: "var(--positive)" },
  NEEDS_REAUTH: { texto: "Precisa reautorizar", cor: "var(--attention)" },
  ERROR: { texto: "Com erro", cor: "var(--negative)" },
  DISABLED: { texto: "Desativada", cor: "var(--muted)" },
};

function formatarData(data: Date | null): string {
  if (!data) return "nunca sincronizada";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(data);
}

async function sincronizar(formData: FormData) {
  "use server";

  const sessao = await exigirSessao();
  const connectionId = String(formData.get("connectionId"));
  const slug = String(formData.get("slug"));

  // Confirma a posse antes de tocar em qualquer coisa.
  const conexao = await prisma.connection.findFirst({
    where: { id: connectionId, project: { organizationId: sessao.organizationId } },
    select: { id: true },
  });

  if (!conexao) redirect(`/projetos/${slug}?erro=Conexão não encontrada`);

  try {
    const resultado = await syncConnectionIncremental(connectionId);
    revalidatePath(`/projetos/${slug}`);
    redirect(
      `/projetos/${slug}?ok=${encodeURIComponent(
        `${resultado.rowsWritten} registros atualizados`,
      )}`,
    );
  } catch (error) {
    // O engine ja gravou o motivo em Connection.lastError; aqui so avisamos.
    if (error && typeof error === "object" && "digest" in error) throw error;
    revalidatePath(`/projetos/${slug}`);
    redirect(
      `/projetos/${slug}?erro=${encodeURIComponent(
        error instanceof Error ? error.message : "Falha ao sincronizar",
      )}`,
    );
  }
}

async function removerConexao(formData: FormData) {
  "use server";

  const sessao = await exigirSessao();
  const connectionId = String(formData.get("connectionId"));
  const slug = String(formData.get("slug"));

  // deleteMany com o filtro da organizacao: se nao for dela, apaga zero linhas
  // em vez de apagar a conexao de outra pessoa.
  await prisma.connection.deleteMany({
    where: { id: connectionId, project: { organizationId: sessao.organizationId } },
  });

  revalidatePath(`/projetos/${slug}`);
  redirect(`/projetos/${slug}?ok=Conexão removida`);
}

export default async function PaginaProjeto({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ erro?: string; ok?: string }>;
}) {
  const sessao = await exigirSessao();
  const { slug } = await params;
  const { erro, ok } = await searchParams;

  const projeto = await buscarProjeto(slug, sessao.organizationId);
  if (!projeto) notFound();

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
          <Link href="/projetos">← Todos os projetos</Link>
        </p>

        <div className="pagina-head">
          <div>
            <h1>{projeto.name}</h1>
            <p>Contas vinculadas a este cliente.</p>
          </div>
        </div>

        {ok ? (
          <p className="alert info" style={{ marginBottom: "20px" }}>
            {ok}
          </p>
        ) : null}
        {erro ? (
          <p className="alert" style={{ marginBottom: "20px" }}>
            {erro}
          </p>
        ) : null}

        <section style={{ marginBottom: "34px" }}>
          <h2
            style={{
              fontSize: "15px",
              fontWeight: 600,
              margin: "0 0 12px",
            }}
          >
            Vincular uma conta
          </h2>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <a
              className="btn"
              href={`/api/oauth/google/start?projeto=${projeto.slug}`}
            >
              Conectar com Google
            </a>
            <a
              className="btn secundario"
              href={`/api/oauth/meta/start?projeto=${projeto.slug}`}
            >
              Conectar com Meta
            </a>
          </div>
          <p
            style={{
              fontSize: "13.5px",
              color: "var(--muted)",
              margin: "10px 0 0",
              maxWidth: "62ch",
            }}
          >
            Uma autorização do Google já cobre Analytics, Ads e Search Console
            de uma vez. Depois de autorizar, você escolhe quais contas vincular.
          </p>
        </section>

        <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 12px" }}>
          Contas vinculadas
        </h2>

        {projeto.connections.length === 0 ? (
          <div className="vazio">
            <h2>Nenhuma conta vinculada</h2>
            <p>
              Autorize acima e escolha as contas. Depois disso, os dados passam
              a ser atualizados automaticamente todos os dias.
            </p>
          </div>
        ) : (
          <ul className="lista-conexoes">
            {projeto.connections.map((conexao) => {
              const provider = tryGetProvider(conexao.provider);
              const status =
                ROTULO_STATUS[conexao.status] ?? ROTULO_STATUS.DISABLED;

              return (
                <li key={conexao.id} className="conexao">
                  <span
                    className="conexao-cor"
                    aria-hidden="true"
                    style={{ background: provider?.brandColor ?? "#888" }}
                  />

                  <div className="conexao-info">
                    <span className="conexao-nome">{conexao.externalName}</span>
                    <span className="conexao-meta">
                      {provider?.name ?? conexao.provider} ·{" "}
                      <span style={{ color: status.cor }}>{status.texto}</span> ·{" "}
                      {formatarData(conexao.lastSyncedAt)}
                    </span>
                    {conexao.lastError ? (
                      <span className="conexao-erro">{conexao.lastError}</span>
                    ) : null}
                  </div>

                  <div className="conexao-acoes">
                    <form action={sincronizar}>
                      <input
                        type="hidden"
                        name="connectionId"
                        value={conexao.id}
                      />
                      <input type="hidden" name="slug" value={projeto.slug} />
                      <button type="submit" className="btn secundario pequeno">
                        Sincronizar
                      </button>
                    </form>
                    <form action={removerConexao}>
                      <input
                        type="hidden"
                        name="connectionId"
                        value={conexao.id}
                      />
                      <input type="hidden" name="slug" value={projeto.slug} />
                      <button type="submit" className="link-sair">
                        Remover
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
