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

// ---------- Tenant team management (Addendum 1.B: tenant-wide editor is the admin role) ----------

export type TenantMember = {
  membershipId: string;
  userId: string;
  email: string;
  name: string;
  role: "editor" | "viewer";
  totpEnabled: boolean;
  hasPassword: boolean;
  isLocked: boolean;
};

// "Locked right now" is resolved here, not left as a raw timestamp for the
// page component to compare against Date.now() itself — a React server
// component's render body must stay a pure function of its props/data,
// and evaluating "now" belongs in the data layer, not render.
export function listTenantMembers(tenantId: string, actingUserId: string): Promise<TenantMember[]> {
  return withTenant(tenantId, actingUserId, (tx) =>
    tx
      .select({
        membershipId: tenantMemberships.id,
        userId: users.id,
        email: users.email,
        name: users.name,
        role: tenantMemberships.role,
        totpEnabled: users.totpEnabled,
        hasPassword: sql<boolean>`${users.passwordHash} is not null`,
        isLocked: sql<boolean>`${users.lockedUntil} is not null and ${users.lockedUntil} > now()`,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(eq(tenantMemberships.tenantId, tenantId))
      .orderBy(users.email),
  );
}

async function countEditors(tenantId: string, tx: typeof db): Promise<number> {
  const rows = await tx
    .select({ id: tenantMemberships.id })
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.role, "editor")));
  return rows.length;
}

/**
 * Adds someone to a tenant — finds the user by email or creates one. If
 * they've never completed account setup (no password yet), returns
 * needsSetup so the caller can send them a setup link; an existing active
 * user just gains access to one more tenant with no new credential needed
 * (users are global, per users.ts).
 */
export async function inviteMember(
  tenantId: string,
  actingUserId: string,
  input: { email: string; name?: string; role: "editor" | "viewer" },
): Promise<{ userId: string; needsSetup: boolean }> {
  const email = input.email.trim().toLowerCase();
  let user = await getUserByEmail(email);
  if (!user) {
    const [created] = await db
      .insert(users)
      .values({ email, name: input.name?.trim() || email.split("@")[0] })
      .returning();
    user = created;
  }

  await withTenant(tenantId, actingUserId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, user!.id)));
    if (existing) throw new Error(`${email} is already a member of this tenant.`);
    await tx.insert(tenantMemberships).values({ tenantId, userId: user!.id, role: input.role });
  });

  return { userId: user.id, needsSetup: !user.passwordHash };
}

export async function updateMemberRole(
  tenantId: string,
  actingUserId: string,
  membershipId: string,
  role: "editor" | "viewer",
): Promise<void> {
  await withTenant(tenantId, actingUserId, async (tx) => {
    const [membership] = await tx
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.id, membershipId), eq(tenantMemberships.tenantId, tenantId)));
    if (!membership) throw new Error("Membership not found.");

    if (membership.role === "editor" && role === "viewer" && (await countEditors(tenantId, tx)) <= 1) {
      throw new Error("Can't demote the last editor — promote someone else first, then try again.");
    }

    await tx.update(tenantMemberships).set({ role }).where(eq(tenantMemberships.id, membershipId));
  });
}

export async function removeMember(tenantId: string, actingUserId: string, membershipId: string): Promise<void> {
  await withTenant(tenantId, actingUserId, async (tx) => {
    const [membership] = await tx
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.id, membershipId), eq(tenantMemberships.tenantId, tenantId)));
    if (!membership) throw new Error("Membership not found.");

    if (membership.role === "editor" && (await countEditors(tenantId, tx)) <= 1) {
      throw new Error("Can't remove the last editor from this tenant.");
    }

    await tx.delete(tenantMemberships).where(eq(tenantMemberships.id, membershipId));
  });
}
