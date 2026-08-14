import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Short-lived, stateless, HMAC-signed bridge tokens — specifically for
// carrying "the password step already succeeded" from one page load to
// the next (password page -> TOTP page) without a DB row or exposing the
// password itself. Not used for the longer-lived account-setup/reset
// links (see password-setup-tokens.ts / db/queries/auth.ts) — those are
// DB-backed so they can be looked up, marked used, and are meaningfully
// longer-lived, which a bare HMAC token with no revocation path shouldn't be.
function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return secret;
}

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

export function signToken(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = { ...payload, exp: Date.now() + ttlSeconds * 1000 };
  const bodyB64 = base64url(Buffer.from(JSON.stringify(body)));
  const signature = base64url(createHmac("sha256", getSecret()).update(bodyB64).digest());
  return `${bodyB64}.${signature}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string): T | null {
  const [bodyB64, signature] = token.split(".");
  if (!bodyB64 || !signature) return null;

  const expectedSignature = base64url(createHmac("sha256", getSecret()).update(bodyB64).digest());
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const body = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf-8")) as T & { exp: number };
    if (typeof body.exp !== "number" || body.exp < Date.now()) return null;
    return body;
  } catch {
    return null;
  }
}

/** A high-entropy random token for account-setup/reset links — returned raw to the caller, only its hash is ever stored. */
export function generateSetupToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSetupToken(token: string): string {
  return createHmac("sha256", getSecret()).update(token).digest("hex");
}
