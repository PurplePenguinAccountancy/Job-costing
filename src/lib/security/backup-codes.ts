import { createHmac, randomInt } from "node:crypto";

const CODE_COUNT = 10;
const CODE_LENGTH = 10;
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I — avoids visual ambiguity

function generateOneCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
    if (i === 4) code += "-";
  }
  return code;
}

/** Ten fresh backup codes, shown to the user exactly once — only their hashes are ever stored. */
export function generateBackupCodes(): string[] {
  return Array.from({ length: CODE_COUNT }, generateOneCode);
}

// Already-high-entropy random codes (not user-chosen passwords), so a
// fast keyed hash is appropriate — scrypt's deliberate slowness exists to
// blunt brute-forcing a low-entropy human-chosen secret, which doesn't
// apply here, and login lockout (see auth.ts) already rate-limits guessing.
function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return secret;
}

export function hashBackupCode(code: string): string {
  return createHmac("sha256", getSecret()).update(code.toUpperCase().trim()).digest("hex");
}
