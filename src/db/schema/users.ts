import { sql } from "drizzle-orm";
import { pgTable, timestamp, uuid, text, integer, boolean } from "drizzle-orm/pg-core";

// Users are global (an accountant may work across multiple tenants);
// tenant_memberships is what scopes a user into a specific tenant.
//
// Password + mandatory TOTP 2FA (explicit security/GDPR requirement —
// magic-link sign-in was judged a higher risk and removed). Security
// fields live directly on this table rather than a separate auth-adapter
// table: Auth.js's Credentials provider requires JWT sessions, which need
// no database adapter at all, so there's no separate "auth user" table to
// reconcile with this one anymore.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  // Null until the user completes account setup (see password_setup_tokens)
  // — scrypt (Node's built-in crypto), never a third-party hashing lib.
  passwordHash: text("password_hash"),
  // AES-256-GCM ciphertext (key: AUTH_TOTP_ENCRYPTION_KEY) — a TOTP secret
  // is as sensitive as a password and must never sit in the DB in plain
  // text. Null until enrollment; totpEnabled only flips true once the
  // user has confirmed a real code against it (a scanned-but-unconfirmed
  // secret doesn't count as 2FA actually being active).
  totpSecretEncrypted: text("totp_secret_encrypted"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  // Brute-force lockout — incremented on every failed password or TOTP
  // attempt, reset to 0 on success. lockedUntil is set once the threshold
  // is hit; both the password and TOTP steps check it.
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  // Bumped to force every outstanding JWT for this user to stop working
  // immediately (checked in auth.ts's jwt callback) — the incident-response
  // lever JWT sessions don't otherwise give you, since there's no server-side
  // session row to delete.
  tokenVersion: integer("token_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
