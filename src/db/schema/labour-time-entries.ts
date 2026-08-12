import { sql } from "drizzle-orm";
import { pgTable, timestamp, uuid, numeric, date, text, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { employees } from "./employees";
import { jobs } from "./jobs";
import { tenantIsolationPolicies } from "./rls-helpers";

// The fixed hours-import template (Addendum 2.I / brief section 8) —
// project-level person-time only, hours/days per employee per job. Cost is
// never imported here — it's calculated from employee_rates at posting
// time (postLabourPeriod), never from this raw time data directly.
//
// jobId is NOT NULL: the non-project/overhead bucket the brief requires is
// a real job like any other (an "Overhead" job every tenant has), not a
// nullable special case — consistent with "no special-casing" elsewhere in
// the hierarchy (brief section 3).
export const labourTimeEntries = pgTable(
  "labour_time_entries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    date: date("date").notNull(),
    hours: numeric("hours", { precision: 6, scale: 2 }).notNull(),
    // Groups one import file's rows together — audit trail, cheap to
    // capture now, expensive to backfill later.
    importBatchId: text("import_batch_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One row per employee/job/day — a re-import of the same timesheet line
    // is almost always an accidental duplicate, not a genuine second entry
    // (importTimeEntries checks this before insert and reports it as an
    // error; this constraint is the backstop for anything that races past
    // that check).
    unique("labour_time_entries_employee_job_date_unique").on(table.employeeId, table.jobId, table.date),
    ...tenantIsolationPolicies(table.tenantId, "labour_time_entries"),
  ],
).enableRLS();
