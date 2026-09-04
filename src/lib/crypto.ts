/**
 * Criptografia dos tokens OAuth em repouso (AES-256-GCM).
 *
 * Access e refresh tokens dao acesso as contas de anuncio dos seus clientes.
 * Um dump de banco vazado nao pode virar acesso as contas deles, entao nada
 * de token em texto puro - nem em log, nem em coluna.
 *
 * Gere a chave com:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY nao definida. Gere uma com: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  // Aceita base64 de 32 bytes; qualquer outra coisa vira chave via SHA-256
  // para nao quebrar em ambiente de desenvolvimento.
  const decoded = Buffer.from(raw, "base64");
  cachedKey =
    decoded.length === 32 ? decoded : createHash("sha256").update(raw).digest();

  return cachedKey;
}

/** Formato: v1.<iv>.<authTag>.<ciphertext>, tudo em base64url. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decrypt(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Payload criptografado invalido ou de versao desconhecida");
  }

  const [, ivPart, tagPart, dataPart] = parts;
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Criptografa valores opcionais sem espalhar `? :` pelo codigo de chamada. */
export function encryptNullable(value: string | null | undefined): string | null {
  return value ? encrypt(value) : null;
}

export function decryptNullable(value: string | null | undefined): string | null {
  return value ? decrypt(value) : null;
}

/**
 * Comparacao em tempo constante, para o segredo do endpoint de cron e para
 * senha de relatorio publico.
 */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
