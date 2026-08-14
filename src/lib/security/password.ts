import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt (Node's built-in KDF, no third-party dependency) — N/r/p are
// stored alongside the hash so they can be tuned later without breaking
// hashes already issued. 64-byte derived key, matching scrypt's own
// recommended output length.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

// NIST SP 800-63B: favour length over forced complexity rules (no
// mandatory uppercase/digit/symbol regex) — that guidance produces
// stronger real-world passwords than composition rules do.
export const MIN_PASSWORD_LENGTH = 12;

export function validatePasswordStrength(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

// Synchronous — scrypt is deliberately CPU-heavy (that's what makes it a
// good password KDF), and at this app's traffic volume a brief blocking
// call at sign-in time is a reasonable, standard trade-off (the same one
// bcrypt-based stacks make); revisit with a worker thread if login volume
// ever makes that not true.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derivedKey = scryptSync(password, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });

  // Lengths must match before timingSafeEqual — it throws on mismatched
  // buffer lengths rather than returning false.
  if (derivedKey.length !== expected.length) return false;
  return timingSafeEqual(derivedKey, expected);
}
