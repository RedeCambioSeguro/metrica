import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { hashPassword, validarSenha } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { gerarSlug } from "@/server/tenancy";

export const metadata: Metadata = {
  title: "Configuração inicial",
  robots: { index: false },
};

// Le o banco a cada acesso: precisa refletir na hora que o primeiro usuario
// foi criado, senao a pagina continuaria aberta em cache.
export const dynamic = "force-dynamic";

/**
 * Cria o primeiro usuario e a organizacao.
 *
 * A pagina se fecha sozinha depois disso - a checagem de "existe algum
 * usuario?" acontece tanto na renderizacao quanto dentro da server action.
 * Checar apenas na renderizacao deixaria a rota aberta para quem enviasse o
 * formulario direto, sem passar pela tela.
 */
async function criarPrimeiroAcesso(formData: FormData) {
  "use server";

  if ((await prisma.user.count()) > 0) {
    redirect("/entrar");
  }

  const nome = String(formData.get("nome") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .toLowerCase()
    .trim();
  const senha = String(formData.get("senha") ?? "");
  const organizacao = String(formData.get("organizacao") ?? "").trim();

  const erro =
    !nome || !email || !organizacao
      ? "Preencha todos os campos."
      : validarSenha(senha);

  if (erro) {
    redirect(`/configuracao-inicial?erro=${encodeURIComponent(erro)}`);
  }

  await prisma.organization.create({
    data: {
      name: organizacao,
      slug: gerarSlug(organizacao) || "organizacao",
      memberships: {
        create: {
          role: "OWNER",
          user: {
            create: {
              name: nome,
              email,
              passwordHash: hashPassword(senha),
              emailVerified: new Date(),
            },
          },
        },
      },
    },
  });

  redirect("/entrar?criado=1");
}

export default async function ConfiguracaoInicial({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  // Depois que existe um usuario, esta tela deixa de existir.
  if ((await prisma.user.count()) > 0) {
    redirect("/entrar");
  }

  const { erro } = await searchParams;

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Configuração inicial</h1>
        <p className="sub">
          Esta tela aparece uma única vez, para criar o primeiro acesso e a sua
          organização. Depois disso ela se fecha sozinha.
        </p>

        {erro ? <p className="alert">{erro}</p> : null}

        <form action={criarPrimeiroAcesso} className="form">
          <div className="field">
            <label htmlFor="organizacao">Nome da organização</label>
            <input
              id="organizacao"
              name="organizacao"
              className="input"
              required
              autoComplete="organization"
              placeholder="Rede Câmbio Seguro"
            />
            <span className="hint">
              É o topo da hierarquia. Cada cliente vira um projeto dentro dela.
            </span>
          </div>

          <div className="field">
            <label htmlFor="nome">Seu nome</label>
            <input
              id="nome"
              name="nome"
              className="input"
              required
              autoComplete="name"
            />
          </div>

          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              className="input"
              required
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label htmlFor="senha">Senha</label>
            <input
              id="senha"
              name="senha"
              type="password"
              className="input"
              required
              minLength={10}
              autoComplete="new-password"
            />
            <span className="hint">
              No mínimo 10 caracteres, com ao menos uma letra e um número.
            </span>
          </div>

          <button type="submit" className="btn">
            Criar acesso
          </button>
        </form>
      </div>
    </div>
  );
}
