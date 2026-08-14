import { sql } from "drizzle-orm";
import { pgTable, pgEnum, timestamp, uuid, text } from "drizzle-orm/pg-core";
import { users } from "./users";

// Bootstrap/recovery path now that sign-in itself is password+TOTP, not
// email magic-link: a new user (or someone who's lost their password)
// still needs a one-time emailed link to set a new password from, exactly
// like every other password-based product. Only the token is stored
// hashed (same reasoning as backup codes) — the raw token only ever
// exists in the URL sent to the user.
export const passwordSetupTokenPurpose = pgEnum("password_setup_token_purpose", [
  "initial_setup",
  "reset",
]);

export const passwordSetupTokens = pgTable("password_setup_tokens", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  purpose: passwordSetupTokenPurpose("purpose").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
