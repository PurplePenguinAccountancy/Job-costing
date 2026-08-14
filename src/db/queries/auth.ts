import { and, eq, isNull, sql } from "drizzle-orm";
import { db, withTenant, withUser } from "@/db";
import { tenants, tenantMemberships, users, userBackupCodes, passwordSetupTokens } from "@/db/schema";
import { generateSetupToken, hashSetupToken } from "@/lib/security/tokens";

// Brute-force lockout policy — checked on every password AND every TOTP
// attempt, so an attacker can't dodge it by trying passwords fast and
// TOTP codes separately.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const SETUP_TOKEN_TTL_HOURS = 24;

export type UserTenant = { id: string; name: string; role: "editor" | "viewer" };

/** Every tenant the signed-in user belongs to — the bootstrap query, before any tenant is selected. */
export function getUserTenants(userId: string): Promise<UserTenant[]> {
  return withUser(userId, (tx) =>
    tx
      .select({ id: tenants.id, name: tenants.name, role: tenantMemberships.role })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(eq(tenantMemberships.userId, userId))
      .orderBy(tenants.name),
  );
}

/**
 * Whether the signed-in user actually belongs to this tenant — the real
 * access-control check for every /t/[tenantId] route (middleware only
 * confirms *someone* is signed in, not that they belong to this specific
 * tenant; see src/app/t/[tenantId]/layout.tsx).
 */
export async function getMembership(tenantId: string, userId: string) {
  return withTenant(tenantId, userId, async (tx) => {
    const [row] = await tx
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)));
    return row ?? null;
  });
}

// ---------- Password / TOTP / lockout (users is global, no RLS — same as tenants) ----------

export async function getUserByEmail(email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return row ?? null;
}

export async function getUserById(userId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  return row ?? null;
}

export function isLockedOut(user: { lockedUntil: Date | null }): boolean {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now();
}

/** Call on any failed password or TOTP attempt. Locks the account once the threshold is hit. */
export async function recordFailedLogin(userId: string): Promise<void> {
  const user = await getUserById(userId);
  if (!user) return;
  const attempts = user.failedLoginAttempts + 1;
  await db
    .update(users)
    .set({
      failedLoginAttempts: attempts,
      lockedUntil: attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/** Call once a login fully succeeds (both factors verified). */
export async function resetFailedLogins(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function setUserPassword(userId: string, passwordHash: string): Promise<void> {
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
}

/** Secret stored, but 2FA isn't "on" until confirmTotpEnrollment — a scanned-but-unconfirmed QR code doesn't count. */
export async function startTotpEnrollment(userId: string, encryptedSecret: string): Promise<void> {
  await db
    .update(users)
    .set({ totpSecretEncrypted: encryptedSecret, totpEnabled: false, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function confirmTotpEnrollment(userId: string): Promise<void> {
  await db.update(users).set({ totpEnabled: true, updatedAt: new Date() }).where(eq(users.id, userId));
}

/** Forces every outstanding JWT for this user to stop working immediately (checked in auth.ts's jwt callback). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function replaceBackupCodes(userId: string, codeHashes: string[]): Promise<void> {
  await db.delete(userBackupCodes).where(eq(userBackupCodes.userId, userId));
  if (codeHashes.length > 0) {
    await db.insert(userBackupCodes).values(codeHashes.map((codeHash) => ({ userId, codeHash })));
  }
}

/** Consumes (deletes) a matching backup code if one exists — single-use, so a stolen DB snapshot can't replay it. */
export async function consumeBackupCode(userId: string, codeHash: string): Promise<boolean> {
  const rows = await db
    .delete(userBackupCodes)
    .where(and(eq(userBackupCodes.userId, userId), eq(userBackupCodes.codeHash, codeHash)))
    .returning({ id: userBackupCodes.id });
  return rows.length > 0;
}

// ---------- Account setup / password reset links ----------

/** Generates a one-time setup/reset link token — returns the RAW token (only its hash is stored). */
export async function createPasswordSetupToken(
  userId: string,
  purpose: "initial_setup" | "reset",
): Promise<string> {
  const rawToken = generateSetupToken();
  await db.insert(passwordSetupTokens).values({
    userId,
    tokenHash: hashSetupToken(rawToken),
    purpose,
    expiresAt: new Date(Date.now() + SETUP_TOKEN_TTL_HOURS * 60 * 60_000),
  });
  return rawToken;
}

/** Validates a setup/reset token (unused, unexpired) and returns the userId it belongs to, or null. */
export async function verifyPasswordSetupToken(rawToken: string): Promise<{ userId: string; tokenId: string } | null> {
  const tokenHash = hashSetupToken(rawToken);
  const [row] = await db
    .select()
    .from(passwordSetupTokens)
    .where(and(eq(passwordSetupTokens.tokenHash, tokenHash), isNull(passwordSetupTokens.usedAt)));
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return { userId: row.userId, tokenId: row.id };
}

export async function markSetupTokenUsed(tokenId: string): Promise<void> {
  await db.update(passwordSetupTokens).set({ usedAt: new Date() }).where(eq(passwordSetupTokens.id, tokenId));
}
