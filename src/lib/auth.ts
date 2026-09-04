/**
 * Autenticacao da plataforma (Auth.js v5).
 *
 * Sessao em JWT, nao em banco. Dois motivos: o provedor de credenciais do
 * Auth.js exige JWT, e assim cada requisicao nao gasta uma ida ao Postgres so
 * para validar quem esta logado.
 *
 * Nao confundir com src/server/oauth/ - aquilo e o acesso as contas de anuncio
 * dos clientes. Aqui e so o login de quem usa a Metrica.
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Necessario na Vercel: o host chega via header de proxy.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/entrar" },

  providers: [
    Credentials({
      name: "E-mail e senha",
      credentials: {
        email: { label: "E-mail", type: "email" },
        senha: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "")
          .toLowerCase()
          .trim();
        const senha = String(credentials?.senha ?? "");

        if (!email || !senha) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true, name: true, passwordHash: true },
        });

        // Mesma resposta para usuario inexistente e senha errada: dizer qual
        // dos dois falhou entrega ao atacante quais e-mails existem.
        if (!user?.passwordHash) return null;
        if (!verifyPassword(senha, user.passwordHash)) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;

        // A organizacao entra no token para evitar uma consulta por pagina.
        const membership = await prisma.membership.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: "asc" },
          select: { organizationId: true, role: true },
        });

        token.organizationId = membership?.organizationId;
        token.role = membership?.role;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.organizationId = token.organizationId as string | undefined;
        session.user.role = token.role as string | undefined;
      }
      return session;
    },
  },
});
