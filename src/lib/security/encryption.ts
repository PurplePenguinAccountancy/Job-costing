import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for TOTP secrets at rest — a TOTP secret is as sensitive as
// a password (whoever has it can generate valid codes), so it must never
// sit in the database in plain text the way, say, a display name can.
// Key: 32 random bytes, base64-encoded in AUTH_TOTP_ENCRYPTION_KEY. GCM's
// auth tag means a tampered ciphertext fails to decrypt rather than
// silently returning garbage.
function getKey(): Buffer {
  const raw = process.env.AUTH_TOTP_ENCRYPTION_KEY;
  if (!raw) throw new Error("AUTH_TOTP_ENCRYPTION_KEY is not set — see .env.example.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("AUTH_TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).");
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptSecret(encoded: string): string {
  const [ivB64, authTagB64, ciphertextB64] = encoded.split(".");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted secret.");
  }
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf-8");
}
