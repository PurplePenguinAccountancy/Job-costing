import { sql } from "drizzle-orm";
import {
  pgTable,
  timestamp,
  uuid,
  text,
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import { tenantIsolationPolicies } from "./rls-helpers";

/**
 * The job tree. A job is a folder: it can hold cost directly (cost_transactions
 * and budgets post against job_id at ANY node, not just leaves) and it can
 * also contain other jobs. A flat single-level job is just a folder with no
 * children — same table, same rules, no special-casing for "simple" jobs.
 *
 * Depth is unlimited and client-configurable; nothing here enforces a
 * required level before children can exist — that's a soft warning in the
 * application layer, never a DB constraint, per the brief (never hard-block).
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => jobs.id, {
      onDelete: "restrict",
    }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    // Manager/PM (Addendum 1.B) — core for all tiers. Nullable: not every
    // job need be assigned on creation.
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    // Who to bill for this job's milestones (section 9). Nullable and not
    // inherited via a DB relationship — a leaf job with no clientName of its
    // own resolves one from the nearest ancestor that has one set, the same
    // "any node, walk up if unset" spirit as the rest of the job tree.
    clientName: text("client_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("jobs_tenant_code_unique").on(table.tenantId, table.code),
    ...tenantIsolationPolicies(table.tenantId, "jobs"),
  ],
).enableRLS();
