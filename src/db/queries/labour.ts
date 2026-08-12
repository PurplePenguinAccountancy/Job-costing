import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { withTenant } from "@/db";
import {
  employees,
  employeeRates,
  labourTimeEntries,
  labourSettings,
  costTransactions,
  costTypeAccounts,
  jobs,
} from "@/db/schema";
import { XeroAdapter } from "@/lib/accounting/xero-adapter";
import type { JournalLine, AccountBalance } from "@/lib/accounting/adapter";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Dedicated accounts, per Addendum 2.J — a generic "Direct Expenses"
// bucket would mix labour variance in with unrelated costs, making it
// useless for anyone actually trying to read it. These are created (not
// reused) specifically so the variance and job-costed labour figures are
// unambiguous in Xero, not just in Wayleave.
const LABOUR_JOB_COSTED_ACCOUNT = { code: "321", name: "Direct Labour (Job Costed)" };
const LABOUR_VARIANCE_ACCOUNT = { code: "322", name: "Labour Rate Variance" };

/**
 * Idempotent setup step: finds or creates the two dedicated Xero accounts
 * labour posting needs, and records the mapping. Safe to call repeatedly —
 * only creates an account if one with that exact code doesn't already
 * exist (Addendum 2.J: check first, create only when nothing suitable is
 * found).
 */
export function getLabourAccountMappings(tenantId: string) {
  return withTenant(tenantId, null, (tx) =>
    tx
      .select()
      .from(costTypeAccounts)
      .where(
        and(
          eq(costTypeAccounts.tenantId, tenantId),
          inArray(costTypeAccounts.costType, ["labour", "labour_variance"]),
        ),
      ),
  );
}

export async function ensureLabourXeroAccounts(tenantId: string) {
  const adapter = new XeroAdapter();
  const existing = await adapter.listCostOfSalesAccounts();

  async function ensureAccount(target: { code: string; name: string }) {
    return existing.find((a) => a.code === target.code) ?? (await adapter.createCostOfSalesAccount(target));
  }

  const labourAccount = await ensureAccount(LABOUR_JOB_COSTED_ACCOUNT);
  const varianceAccount = await ensureAccount(LABOUR_VARIANCE_ACCOUNT);

  await withTenant(tenantId, null, async (tx) => {
    for (const [costType, account] of [
      ["labour", labourAccount],
      ["labour_variance", varianceAccount],
    ] as const) {
      await tx
        .insert(costTypeAccounts)
        .values({
          tenantId,
          costType,
          xeroAccountCode: account.code,
          xeroAccountId: account.id,
          isWayleaveManaged: true,
        })
        .onConflictDoUpdate({
          target: [costTypeAccounts.tenantId, costTypeAccounts.costType],
          set: { xeroAccountCode: account.code, xeroAccountId: account.id, isWayleaveManaged: true },
        });
    }
  });

  return { labourAccount, varianceAccount };
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
    payrollClearingAccountCode?: string | null;
  },
) {
  // The payroll clearing account and the two job-costed accounts must be
  // genuinely separate — the whole reclassification journal is "move money
  // OUT of clearing INTO labour + variance" (see labour-settings.ts), which
  // is meaningless (and would double- or zero-count the period) if clearing
  // IS one of the accounts it's supposedly moving money into.
  if (input.payrollClearingAccountCode) {
    const mappings = await getLabourAccountMappings(tenantId);
    const collision = mappings.find((m) => m.xeroAccountCode === input.payrollClearingAccountCode);
    if (collision) {
      const label = collision.costType === "labour" ? "job-costed Direct Labour" : "Labour Rate Variance";
      throw new Error(
        `Payroll clearing account can't be the same as the ${label} account (${input.payrollClearingAccountCode}) — the reclassification journal moves money out of clearing into that account, so they must be distinct.`,
      );
    }
  }

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

      // Same employee, same job, same day already imported — almost always
      // an accidental re-upload of the same timesheet, not a genuine second
      // entry (the format has no time-of-day to distinguish two real
      // entries). Reported as an error, not silently inserted or silently
      // skipped, same "nothing disappears without being shown" rule as the
      // document capture pipeline.
      const [existing] = await tx
        .select({ id: labourTimeEntries.id })
        .from(labourTimeEntries)
        .where(
          and(
            eq(labourTimeEntries.tenantId, tenantId),
            eq(labourTimeEntries.employeeId, employee.id),
            eq(labourTimeEntries.jobId, job.id),
            eq(labourTimeEntries.date, row.date),
          ),
        );
      if (existing) {
        errors.push({
          line: index + 1,
          raw: `${row.employeeIdentifier},${row.jobCode},${row.date},${row.hours}`,
          message: `Already imported: ${row.employeeIdentifier} on ${row.jobCode} for ${row.date} — skipped as a likely duplicate.`,
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

  const periodKey = `${params.periodStart}_${params.periodEnd}`;
  const varianceKey = `${periodKey}_variance`;
  const alreadyPosted = await withTenant(tenantId, null, (tx) =>
    tx
      .select({ id: costTransactions.id })
      .from(costTransactions)
      .where(
        and(
          eq(costTransactions.tenantId, tenantId),
          eq(costTransactions.sourceType, "labour_allocation"),
          inArray(costTransactions.sourceReference, [periodKey, varianceKey]),
        ),
      )
      .limit(1),
  );
  if (alreadyPosted.length > 0) {
    throw new Error(
      `Labour period ${params.periodStart} to ${params.periodEnd} has already been posted — refusing to create duplicate transactions. Review the existing entries in the approval queue instead of re-posting.`,
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
          sourceReference: periodKey,
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
          sourceReference: varianceKey,
          transactionDate: params.transactionDate,
          description: `Labour rate variance: actual payroll £${params.actualPayrollTotal.toFixed(2)} vs standard-allocated £${totalAllocated.toFixed(2)}`,
        })
        .returning();
      varianceTransactionId = v.id;
    }

    return { jobTransactionIds, varianceTransactionId, totalAllocated, variance };
  });
}

// ---------- Pushing a period's reclassification journal to Xero ----------

export type LabourPeriodSummary = {
  periodStart: string;
  periodEnd: string;
  totalAllocated: number;
  variance: number;
  transactionCount: number;
};

/**
 * Groups labour_allocation transactions by period — sourceReference is
 * `${periodStart}_${periodEnd}` for job lines and
 * `${periodStart}_${periodEnd}_variance` for the variance line, so
 * stripping the suffix is enough to group them back into one period. Only
 * periods where EVERY transaction is approved are returned — a period with
 * even one still-pending line isn't ready to sync, and syncing just the
 * approved subset would push a partial (wrong) total to Xero. `posted`
 * periods are excluded from the base query entirely, so an already-synced
 * period naturally disappears rather than needing separate filtering.
 */
export async function getApprovedLabourPeriods(tenantId: string): Promise<LabourPeriodSummary[]> {
  const rows = await withTenant(tenantId, null, (tx) =>
    tx
      .select({
        amount: costTransactions.amount,
        sourceReference: costTransactions.sourceReference,
        approvalStatus: costTransactions.approvalStatus,
      })
      .from(costTransactions)
      .where(
        and(
          eq(costTransactions.tenantId, tenantId),
          eq(costTransactions.sourceType, "labour_allocation"),
          // postLabourPeriod only ever inserts as pending_approval — draft
          // is never used for this sourceType, so it's excluded here too.
          inArray(costTransactions.approvalStatus, ["pending_approval", "approved"]),
        ),
      ),
  );

  const periods = new Map<string, LabourPeriodSummary & { allApproved: boolean }>();
  for (const row of rows) {
    const ref = row.sourceReference ?? "";
    const isVariance = ref.endsWith("_variance");
    const key = isVariance ? ref.slice(0, -"_variance".length) : ref;
    const [periodStart, periodEnd] = key.split("_");
    if (!periodStart || !periodEnd) continue;

    if (!periods.has(key)) {
      periods.set(key, { periodStart, periodEnd, totalAllocated: 0, variance: 0, transactionCount: 0, allApproved: true });
    }
    const summary = periods.get(key)!;
    if (isVariance) summary.variance += Number(row.amount);
    else summary.totalAllocated += Number(row.amount);
    summary.transactionCount++;
    if (row.approvalStatus !== "approved") summary.allApproved = false;
  }

  return [...periods.values()]
    .filter((p) => p.allApproved)
    .map((p) => ({
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      totalAllocated: round2(p.totalAllocated),
      variance: round2(p.variance),
      transactionCount: p.transactionCount,
    }));
}

/**
 * Posts the reclassification journal for one period (Dr job-costed Direct
 * Labour, Dr/Cr Labour Rate Variance, Cr the payroll clearing account) and
 * marks every transaction in that period `posted`. Refuses to run unless
 * every transaction in the period is already approved — never syncs a
 * partial period.
 */
export async function pushLabourPeriodToXero(
  tenantId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ journalId: string; totalAllocated: number; variance: number; signConventionWarning: string | null }> {
  const periodKey = `${periodStart}_${periodEnd}`;
  const varianceKey = `${periodKey}_variance`;

  const settings = await getLabourSettings(tenantId);
  if (!settings?.payrollClearingAccountCode) {
    throw new Error("Payroll clearing account isn't configured yet — set it in Labour settings first.");
  }

  const rows = await withTenant(tenantId, null, (tx) =>
    tx
      .select({
        id: costTransactions.id,
        amount: costTransactions.amount,
        sourceReference: costTransactions.sourceReference,
        approvalStatus: costTransactions.approvalStatus,
      })
      .from(costTransactions)
      .where(
        and(
          eq(costTransactions.tenantId, tenantId),
          eq(costTransactions.sourceType, "labour_allocation"),
          inArray(costTransactions.sourceReference, [periodKey, varianceKey]),
        ),
      ),
  );

  if (rows.length === 0) {
    throw new Error(`No labour transactions found for period ${periodStart} to ${periodEnd}.`);
  }
  const notApproved = rows.filter((r) => r.approvalStatus !== "approved");
  if (notApproved.length > 0) {
    throw new Error(
      `${notApproved.length} transaction(s) in this period aren't approved yet — approve the whole period before syncing.`,
    );
  }

  const totalAllocated = round2(
    rows.filter((r) => r.sourceReference === periodKey).reduce((sum, r) => sum + Number(r.amount), 0),
  );
  const variance = round2(
    rows.filter((r) => r.sourceReference === varianceKey).reduce((sum, r) => sum + Number(r.amount), 0),
  );
  const actualPayrollTotal = round2(totalAllocated + variance);

  const mappings = await withTenant(tenantId, null, (tx) =>
    tx
      .select()
      .from(costTypeAccounts)
      .where(
        and(
          eq(costTypeAccounts.tenantId, tenantId),
          inArray(costTypeAccounts.costType, ["labour", "labour_variance"]),
        ),
      ),
  );
  const labourMapping = mappings.find((m) => m.costType === "labour");
  const varianceMapping = mappings.find((m) => m.costType === "labour_variance");
  if (!labourMapping || !varianceMapping) {
    throw new Error("Labour or variance Xero account isn't set up yet — run account setup first.");
  }

  const lines: JournalLine[] = [
    {
      accountCode: labourMapping.xeroAccountCode,
      amount: totalAllocated,
      description: `Job-costed direct labour, ${periodStart} to ${periodEnd}`,
    },
  ];
  if (Math.abs(variance) >= 0.01) {
    lines.push({
      accountCode: varianceMapping.xeroAccountCode,
      amount: variance,
      description: `Labour rate variance, ${periodStart} to ${periodEnd}`,
    });
  }
  lines.push({
    accountCode: settings.payrollClearingAccountCode,
    amount: -actualPayrollTotal,
    description: `Reclassified to job-costed labour + variance, ${periodStart} to ${periodEnd}`,
  });

  const adapter = new XeroAdapter();

  // Best-effort snapshot before posting, so the sign convention on the
  // journal lines (never live-tested — the custom connection only had
  // manualjournals.read scope as of the last check) can be checked against
  // what actually moved, instead of trusting the implementation blind.
  let balancesBefore: AccountBalance[] | null = null;
  try {
    balancesBefore = await adapter.getAccountBalances();
  } catch {
    // Non-fatal — the check below just gets skipped.
  }

  const journal = await adapter.createManualJournal({
    date: periodEnd,
    narration: `Wayleave labour reclassification: ${periodStart} to ${periodEnd}`,
    lines,
  });

  await withTenant(tenantId, null, (tx) =>
    tx
      .update(costTransactions)
      .set({ approvalStatus: "posted", xeroReference: journal.id })
      .where(
        and(
          eq(costTransactions.tenantId, tenantId),
          inArray(
            costTransactions.id,
            rows.map((r) => r.id),
          ),
        ),
      ),
  );

  // Confirm the journal actually moved the labour account in the expected
  // (+totalAllocated) direction, rather than assuming the sign convention
  // implemented in xero-adapter.ts is correct just because the API call
  // didn't error — a journal can be perfectly valid (nets to zero) and
  // still have every line backwards. Diagnostic only: Xero's Trial Balance
  // report can lag a just-posted journal, so a mismatch is surfaced as a
  // warning to check manually, never a thrown error — the journal has
  // already posted by this point regardless.
  let signConventionWarning: string | null = null;
  if (balancesBefore) {
    try {
      const balancesAfter = await adapter.getAccountBalances();
      const findBalance = (list: AccountBalance[], accountId: string | null) =>
        accountId ? (list.find((b) => b.accountId === accountId)?.balance ?? null) : null;

      const labourBefore = findBalance(balancesBefore, labourMapping.xeroAccountId);
      const labourAfter = findBalance(balancesAfter, labourMapping.xeroAccountId);
      if (labourBefore !== null && labourAfter !== null) {
        const delta = round2(labourAfter - labourBefore);
        // A wider tolerance than the exact-penny rounding used elsewhere —
        // this compares two separately-fetched Trial Balance snapshots, not
        // Wayleave's own arithmetic, and small YTD movement from unrelated
        // activity between the two calls shouldn't read as a sign-convention
        // bug.
        if (Math.abs(delta - totalAllocated) > 0.5) {
          signConventionWarning = `Journal posted (id ${journal.id}), but the Direct Labour account moved by £${delta.toFixed(2)} — expected +£${totalAllocated.toFixed(2)}. Check the journal in Xero: the sign convention may be backwards, or the Trial Balance report hasn't caught up yet.`;
          console.error(`[labour] ${signConventionWarning}`);
        }
      }
    } catch {
      // Diagnostic only — a failure here must never look like the push failed.
    }
  }

  return { journalId: journal.id, totalAllocated, variance, signConventionWarning };
}
