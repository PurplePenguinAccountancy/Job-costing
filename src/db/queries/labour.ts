import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { withTenant } from "@/db";
import {
  employees,
  employeeRates,
  labourTimeEntries,
  labourSettings,
  costTransactions,
  jobs,
} from "@/db/schema";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------- Employees & rates ----------

export function listEmployees(tenantId: string) {
  return withTenant(tenantId, null, (tx) =>
    tx.select().from(employees).where(eq(employees.tenantId, tenantId)).orderBy(employees.name),
  );
}

export async function addEmployee(tenantId: string, input: { employeeIdentifier: string; name: string }) {
  const [row] = await withTenant(tenantId, null, (tx) =>
    tx
      .insert(employees)
      .values({ tenantId, employeeIdentifier: input.employeeIdentifier, name: input.name })
      .returning(),
  );
  return row;
}

export async function addEmployeeRate(
  tenantId: string,
  input: { employeeId: string; rateType: "actual" | "standard"; hourlyRate: string; effectiveFrom: string },
) {
  await withTenant(tenantId, null, (tx) =>
    tx.insert(employeeRates).values({
      tenantId,
      employeeId: input.employeeId,
      rateType: input.rateType,
      hourlyRate: input.hourlyRate,
      effectiveFrom: input.effectiveFrom,
    }),
  );
}

export function listEmployeeRates(tenantId: string) {
  return withTenant(tenantId, null, (tx) =>
    tx
      .select({
        id: employeeRates.id,
        employeeId: employeeRates.employeeId,
        employeeName: employees.name,
        rateType: employeeRates.rateType,
        hourlyRate: employeeRates.hourlyRate,
        effectiveFrom: employeeRates.effectiveFrom,
      })
      .from(employeeRates)
      .innerJoin(employees, eq(employees.id, employeeRates.employeeId))
      .where(eq(employeeRates.tenantId, tenantId))
      .orderBy(employees.name, employeeRates.effectiveFrom),
  );
}

// ---------- Labour settings ----------

export function getLabourSettings(tenantId: string) {
  return withTenant(tenantId, null, async (tx) => {
    const [row] = await tx.select().from(labourSettings).where(eq(labourSettings.tenantId, tenantId));
    return row ?? null;
  });
}

export async function upsertLabourSettings(
  tenantId: string,
  input: {
    costingMethod: "actual" | "standard";
    defaultLabourCostCodeId: string;
    defaultVarianceCostCodeId: string;
    overheadJobId: string;
  },
) {
  await withTenant(tenantId, null, (tx) =>
    tx
      .insert(labourSettings)
      .values({ tenantId, ...input })
      .onConflictDoUpdate({ target: labourSettings.tenantId, set: input }),
  );
}

// ---------- Time-entry import ----------

export type ParsedTimeEntry = { employeeIdentifier: string; jobCode: string; date: string; hours: string };
export type TimeEntryImportError = { line: number; raw: string; message: string };

/**
 * Fixed, standard import format (brief section 8: "not a flexible
 * column-mapper") — employee_identifier,job_code,date,hours, one per line.
 * A header row is detected and skipped if present.
 */
export function parseTimeEntryText(text: string): { rows: ParsedTimeEntry[]; errors: TimeEntryImportError[] } {
  const rows: ParsedTimeEntry[] = [];
  const errors: TimeEntryImportError[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  for (const [index, line] of lines.entries()) {
    const lineNo = index + 1;
    const parts = line.split(",").map((p) => p.trim());
    if (
      lineNo === 1 &&
      parts[0]?.toLowerCase().replace(/\s/g, "") === "employee_identifier"
    ) {
      continue; // header row
    }
    if (parts.length !== 4) {
      errors.push({ line: lineNo, raw: line, message: "Expected 4 fields: employee_identifier,job_code,date,hours" });
      continue;
    }
    const [employeeIdentifier, jobCode, date, hours] = parts;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push({ line: lineNo, raw: line, message: `Date "${date}" must be YYYY-MM-DD` });
      continue;
    }
    if (!hours || isNaN(Number(hours)) || Number(hours) <= 0) {
      errors.push({ line: lineNo, raw: line, message: `Hours "${hours}" must be a positive number` });
      continue;
    }
    rows.push({ employeeIdentifier, jobCode, date, hours });
  }

  return { rows, errors };
}

export type TimeEntryImportResult = {
  created: number;
  errors: TimeEntryImportError[];
};

/**
 * Every row either becomes a labour_time_entries row or a reported error —
 * never a silent drop (same "nothing disappears" rule as the document
 * capture pipeline, Addendum 2.G).
 */
export async function importTimeEntries(
  tenantId: string,
  rows: ParsedTimeEntry[],
  importBatchId: string,
): Promise<TimeEntryImportResult> {
  const errors: TimeEntryImportError[] = [];
  let created = 0;

  await withTenant(tenantId, null, async (tx) => {
    for (const [index, row] of rows.entries()) {
      const [employee] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.tenantId, tenantId), eq(employees.employeeIdentifier, row.employeeIdentifier)));
      if (!employee) {
        errors.push({
          line: index + 1,
          raw: `${row.employeeIdentifier},${row.jobCode},${row.date},${row.hours}`,
          message: `No employee with identifier "${row.employeeIdentifier}"`,
        });
        continue;
      }

      const [job] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.tenantId, tenantId), eq(jobs.code, row.jobCode)));
      if (!job) {
        errors.push({
          line: index + 1,
          raw: `${row.employeeIdentifier},${row.jobCode},${row.date},${row.hours}`,
          message: `No job with code "${row.jobCode}"`,
        });
        continue;
      }

      await tx.insert(labourTimeEntries).values({
        tenantId,
        employeeId: employee.id,
        jobId: job.id,
        date: row.date,
        hours: row.hours,
        importBatchId,
      });
      created++;
    }
  });

  return { created, errors };
}

// ---------- Standard-costing posting (the brief's critical rule) ----------

export type LabourPostingResult = {
  jobTransactionIds: string[];
  varianceTransactionId: string | null;
  totalAllocated: number;
  variance: number;
};

/**
 * Brief section 8's critical rule: never let job-allocated labour cost be
 * independently calculated. Take the actual total payroll cost that posts
 * to Xero for the period, split hours-weighted across jobs using standard
 * rates, and post whatever's left over as a single variance transaction —
 * so job-allocated + variance = actual payroll total, exactly, every
 * period, by construction rather than coincidence.
 */
export async function postLabourPeriod(
  tenantId: string,
  params: { periodStart: string; periodEnd: string; actualPayrollTotal: number; transactionDate: string },
): Promise<LabourPostingResult> {
  const settings = await getLabourSettings(tenantId);
  if (!settings?.defaultLabourCostCodeId || !settings.defaultVarianceCostCodeId || !settings.overheadJobId) {
    throw new Error(
      "Labour settings incomplete — set a default labour cost code, variance cost code, and overhead job first.",
    );
  }

  const hoursByEmployeeJob = await withTenant(tenantId, null, (tx) =>
    tx
      .select({
        employeeId: labourTimeEntries.employeeId,
        jobId: labourTimeEntries.jobId,
        totalHours: sql<string>`sum(${labourTimeEntries.hours})`,
      })
      .from(labourTimeEntries)
      .where(
        and(
          eq(labourTimeEntries.tenantId, tenantId),
          gte(labourTimeEntries.date, params.periodStart),
          lte(labourTimeEntries.date, params.periodEnd),
        ),
      )
      .groupBy(labourTimeEntries.employeeId, labourTimeEntries.jobId),
  );

  if (hoursByEmployeeJob.length === 0) {
    throw new Error(`No time entries found between ${params.periodStart} and ${params.periodEnd}.`);
  }

  const employeeIds = [...new Set(hoursByEmployeeJob.map((r) => r.employeeId))];
  const rates = await withTenant(tenantId, null, (tx) =>
    tx
      .select()
      .from(employeeRates)
      .where(
        and(
          eq(employeeRates.tenantId, tenantId),
          eq(employeeRates.rateType, "standard"),
          inArray(employeeRates.employeeId, employeeIds),
        ),
      ),
  );

  const rateByEmployee = new Map<string, number>();
  for (const employeeId of employeeIds) {
    const candidates = rates
      .filter((r) => r.employeeId === employeeId && r.effectiveFrom <= params.periodEnd)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    if (candidates.length === 0) {
      throw new Error(`No standard rate found for one of the employees, effective on or before ${params.periodEnd}.`);
    }
    rateByEmployee.set(employeeId, Number(candidates[0].hourlyRate));
  }

  const costByJob = new Map<string, number>();
  for (const row of hoursByEmployeeJob) {
    const cost = Number(row.totalHours) * rateByEmployee.get(row.employeeId)!;
    costByJob.set(row.jobId, (costByJob.get(row.jobId) ?? 0) + cost);
  }

  const totalAllocated = round2([...costByJob.values()].reduce((a, b) => a + b, 0));
  const variance = round2(params.actualPayrollTotal - totalAllocated);

  return withTenant(tenantId, null, async (tx) => {
    const jobTransactionIds: string[] = [];
    for (const [jobId, cost] of costByJob) {
      const [t] = await tx
        .insert(costTransactions)
        .values({
          tenantId,
          jobId,
          costCodeId: settings.defaultLabourCostCodeId!,
          type: "actual",
          amount: round2(cost).toFixed(2),
          approvalStatus: "pending_approval",
          sourceType: "labour_allocation",
          sourceReference: `${params.periodStart}_${params.periodEnd}`,
          transactionDate: params.transactionDate,
        })
        .returning();
      jobTransactionIds.push(t.id);
    }

    let varianceTransactionId: string | null = null;
    if (Math.abs(variance) >= 0.01) {
      // Can be negative (over-allocated vs actual payroll) — a legitimate
      // favourable variance, not an error.
      const [v] = await tx
        .insert(costTransactions)
        .values({
          tenantId,
          jobId: settings.overheadJobId!,
          costCodeId: settings.defaultVarianceCostCodeId!,
          type: "actual",
          amount: variance.toFixed(2),
          approvalStatus: "pending_approval",
          sourceType: "labour_allocation",
          sourceReference: `${params.periodStart}_${params.periodEnd}_variance`,
          transactionDate: params.transactionDate,
          description: `Labour rate variance: actual payroll £${params.actualPayrollTotal.toFixed(2)} vs standard-allocated £${totalAllocated.toFixed(2)}`,
        })
        .returning();
      varianceTransactionId = v.id;
    }

    return { jobTransactionIds, varianceTransactionId, totalAllocated, variance };
  });
}
