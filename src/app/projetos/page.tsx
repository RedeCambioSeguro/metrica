import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exigirSessao, gerarSlug, slugDisponivel } from "@/server/tenancy";

export const metadata: Metadata = {
  title: "Projetos",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

async function criarProjeto(formData: FormData) {
  "use server";

  const sessao = await exigirSessao();
  const nome = String(formData.get("nome") ?? "").trim();

  if (!nome) {
    redirect("/projetos?erro=nome");
  }

  const slug = await slugDisponivel(gerarSlug(nome), sessao.organizationId);

  await prisma.project.create({
    data: {
      name: nome,
      slug,
      organizationId: sessao.organizationId,
    },
  });

  revalidatePath("/projetos");
  redirect("/projetos");
}

async function sair() {
  "use server";
  await signOut({ redirectTo: "/entrar" });
}

export default async function Projetos({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const sessao = await exigirSessao();
  const { erro } = await searchParams;

  const [organizacao, projetos] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: sessao.organizationId },
      select: { name: true },
    }),
    prisma.project.findMany({
      where: { organizationId: sessao.organizationId, archivedAt: null },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { connections: true, reports: true } },
      },
    }),
  ]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/projetos" className="marca">
            Métrica
          </Link>
          <div
            style={{ display: "flex", alignItems: "center", gap: "16px" }}
          >
            <span className="org">{organizacao?.name}</span>
            <form action={sair}>
              <button type="submit" className="link-sair">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="pagina">
        <div className="pagina-head">
          <div>
            <h1>Projetos</h1>
            <p>Um projeto por cliente. As contas são vinculadas dentro dele.</p>
          </div>
        </div>

        {erro === "nome" ? (
          <p className="alert" style={{ marginBottom: "20px" }}>
            Informe o nome do cliente.
          </p>
        ) : null}

        <form action={criarProjeto} className="form-inline">
          <div className="field">
            <label htmlFor="nome">Novo projeto</label>
            <input
              id="nome"
              name="nome"
              className="input"
              required
              placeholder="Nome do cliente"
            />
          </div>
          <button type="submit" className="btn">
            Criar projeto
          </button>
        </form>

        {projetos.length === 0 ? (
          <div className="vazio">
            <h2>Nenhum projeto ainda</h2>
            <p>
              Crie o primeiro cliente acima. Em seguida você vincula as contas
              de Google Analytics, Google Ads, Meta Ads e as demais plataformas
              dentro dele.
            </p>
          </div>
        ) : (
          <div className="grade-projetos">
            {projetos.map((projeto) => (
              <Link
                key={projeto.id}
                href={`/projetos/${projeto.slug}`}
                className="cartao-projeto"
              >
                <span className="nome">
                  <span
                    className="marcador"
                    aria-hidden="true"
                    style={{ background: projeto.brandColor }}
                  />
                  {projeto.name}
                </span>
                <span className="contas">
                  {projeto._count.connections === 0
                    ? "Nenhuma conta vinculada"
                    : `${projeto._count.connections} ${
                        projeto._count.connections === 1
                          ? "conta vinculada"
                          : "contas vinculadas"
                      }`}
                  {projeto._count.reports > 0
                    ? ` · ${projeto._count.reports} ${
                        projeto._count.reports === 1
                          ? "relatório"
                          : "relatórios"
                      }`
                    : ""}
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
