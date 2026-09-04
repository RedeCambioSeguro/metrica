/**
 * Hash de senha com scrypt.
 *
 * scrypt vem no proprio Node, entao nao adicionamos dependencia so para isso -
 * e, diferente de um hash simples, ele e deliberadamente caro em CPU e memoria,
 * que e o que torna a forca bruta impraticavel se o banco vazar.
 *
 * Formato guardado: scrypt$<salt>$<hash>, ambos em base64url. O prefixo permite
 * trocar de algoritmo no futuro sem invalidar as senhas existentes.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const derived = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const salt = Buffer.from(parts[1], "base64url");
  const expected = Buffer.from(parts[2], "base64url");
  if (expected.length === 0) return false;

  const derived = scryptSync(password, salt, expected.length);

  // Comparacao em tempo constante: comparar com === vazaria informacao sobre
  // quantos bytes iniciais estavam certos.
  return timingSafeEqual(derived, expected);
}

/** Regras minimas de senha. Devolve a mensagem do problema, ou null se estiver ok. */
export function validarSenha(senha: string): string | null {
  if (senha.length < 10) return "A senha precisa ter ao menos 10 caracteres.";
  if (!/[a-zA-Z]/.test(senha)) return "A senha precisa conter ao menos uma letra.";
  if (!/[0-9]/.test(senha)) return "A senha precisa conter ao menos um número.";
  return null;
}
