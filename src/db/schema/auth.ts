import { pgTable, text, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";

// Auth.js (NextAuth v5, Addendum 2.M) adapter tables — infrastructure the
// auth library owns, not tenant-scoped domain data, so (like tenants/users)
// these carry no RLS policy: a session is protected by its unguessable
// token, not row-level tenant filtering. Column names/types must match
// @auth/drizzle-adapter's expected Postgres schema exactly (see
// node_modules/@auth/drizzle-adapter/lib/pg.js) — required for the
// "database" session strategy the email magic-link provider needs.
//
// Deliberately separate from the domain `users` table (users.ts) rather
// than reshaping it to fit the adapter's expectations — auth.ts's session
// callback resolves back to the real users.id after sign-in, so every
// existing createdBy/ownerId/approvedBy foreign key keeps working
// unchanged.
export const authUsers = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const authAccounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })],
);

export const authSessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const authVerificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);
