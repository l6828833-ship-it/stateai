import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt);

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/**
 * Hash a plaintext password with scrypt + a random per-password salt.
 * Uses Node's built-in crypto (no external dependency). The returned string is
 * self-describing: `scrypt$<saltHex>$<hashHex>` so `verifyPassword` can parse it.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

/**
 * Constant-time verification of a plaintext password against a stored hash.
 * Returns false for any malformed/unknown hash format instead of throwing.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;

  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const storedBuf = Buffer.from(hashHex, "hex");
  if (storedBuf.length !== derived.length) return false;
  return timingSafeEqual(storedBuf, derived);
}
