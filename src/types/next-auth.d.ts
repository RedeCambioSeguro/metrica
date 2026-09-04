import type { DefaultSession } from "next-auth";

/**
 * Campos que a Metrica acrescenta a sessao. Sem esta declaracao, o TypeScript
 * nao sabe que session.user.organizationId existe.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organizationId?: string;
      role?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    organizationId?: string;
    role?: string;
  }
}
