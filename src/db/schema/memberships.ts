import { sql } from "drizzle-orm";
import {
  pgTable,
  pgPolicy,
  pgEnum,
  timestamp,
  uuid,
  unique,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import { appUser } from "./roles";

// Tenant-wide role for v1 (Addendum 1.B): editor sees/acts on everything in
// the tenant, viewer is read-only. Manager-scoped (hierarchy-branch) access
// is a distinct, more granular model layered on top later — not this table.
export const membershipRole = pgEnum("membership_role", ["editor", "viewer"]);

export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("tenant_memberships_tenant_user_unique").on(table.tenantId, table.userId),
    // Bootstrap case: a user must be able to discover which tenants they
    // belong to *before* app.current_tenant_id is set (that's what this
    // query is for) — so this policy keys off current_user_id OR the
    // already-selected tenant, unlike every other table which is tenant-only.
    // NULLIF(..., '') before every cast below: a malformed/empty session
    // variable must fail the match, not throw "invalid input syntax for
    // type uuid" and 500 the whole query (see rls-helpers.ts for the same
    // reasoning, applied there for every other tenant-scoped table).
    pgPolicy("memberships_visible_to_self_or_within_tenant", {
      for: "select",
      to: appUser,
      using: sql`
        ${table.userId} = nullif(current_setting('app.current_user_id', true), '')::uuid
        or ${table.tenantId} = nullif(current_setting('app.current_tenant_id', true), '')::uuid
      `,
    }),
    pgPolicy("memberships_write_within_tenant", {
      for: "insert",
      to: appUser,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.current_tenant_id', true), '')::uuid`,
    }),
    pgPolicy("memberships_update_within_tenant", {
      for: "update",
      to: appUser,
      using: sql`${table.tenantId} = nullif(current_setting('app.current_tenant_id', true), '')::uuid`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.current_tenant_id', true), '')::uuid`,
    }),
    pgPolicy("memberships_delete_within_tenant", {
      for: "delete",
      to: appUser,
      using: sql`${table.tenantId} = nullif(current_setting('app.current_tenant_id', true), '')::uuid`,
    }),
  ],
).enableRLS();
