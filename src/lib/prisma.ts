import { PrismaClient } from "@prisma/client";

// Em dev o Next recria modulos a cada hot reload; sem o singleton o Postgres
// acaba com dezenas de conexoes abertas e comeca a recusar novas.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
