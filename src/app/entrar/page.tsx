import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Entrar",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const MENSAGENS: Record<string, string> = {
  credenciais: "E-mail ou senha incorretos.",
  "sem-organizacao":
    "Sua conta não está vinculada a nenhuma organização. Fale com o administrador.",
  inesperado: "Não foi possível entrar. Tente novamente.",
};

async function entrar(formData: FormData) {
  "use server";

  try {
    await signIn("credentials", {
      email: formData.get("email"),
      senha: formData.get("senha"),
      redirectTo: "/projetos",
    });
  } catch (error) {
    // O signIn sinaliza sucesso lancando um redirect. Deixar passar e o
    // comportamento correto - captura-lo aqui prenderia o usuario na tela.
    if (error instanceof AuthError) {
      const motivo =
        error.type === "CredentialsSignin" ? "credenciais" : "inesperado";
      redirect(`/entrar?erro=${motivo}`);
    }
    throw error;
  }
}

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; criado?: string }>;
}) {
  // Banco sem usuario nenhum: manda para a configuracao inicial em vez de
  // mostrar um login que ninguem consegue usar.
  if ((await prisma.user.count()) === 0) {
    redirect("/configuracao-inicial");
  }

  const { erro, criado } = await searchParams;

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Entrar</h1>
        <p className="sub">Acesso à plataforma de relatórios.</p>

        {criado ? (
          <p className="alert info">
            Acesso criado. Entre com o e-mail e a senha que você acabou de
            definir.
          </p>
        ) : null}

        {erro ? (
          <p className="alert">{MENSAGENS[erro] ?? MENSAGENS.inesperado}</p>
        ) : null}

        <form action={entrar} className="form">
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              className="input"
              required
              autoComplete="email"
              autoFocus
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
              autoComplete="current-password"
            />
          </div>

          <button type="submit" className="btn">
            Entrar
          </button>
        </form>

        <p style={{ marginTop: "24px", fontSize: "14px" }}>
          <Link href="/">Voltar ao início</Link>
        </p>
      </div>
    </div>
  );
}
