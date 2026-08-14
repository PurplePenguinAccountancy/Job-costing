import { sql } from "drizzle-orm";
import { pgTable, timestamp, uuid, text } from "drizzle-orm/pg-core";
import { users } from "./users";

// One-time-use recovery codes, generated in a batch at TOTP enrollment and
// shown exactly once — losing an authenticator device shouldn't mean
// permanent lockout. Hashed the same way passwords are (scrypt); a code is
// deleted (not just flagged) the moment it's used, so a stolen DB snapshot
// can't be replayed against already-spent codes either.
export const userBackupCodes = pgTable("user_backup_codes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
