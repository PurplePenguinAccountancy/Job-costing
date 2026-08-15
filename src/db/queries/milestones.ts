import { and, asc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db";
import { jobs, milestones, billingSettings } from "@/db/schema";
import { allocateAmounts } from "@/lib/allocate-amounts";
import { getJobAncestors } from "./job-tree";

const ROUNDING_TOLERANCE = 0.01;

export type MilestoneRow = {
  id: string;
  sequence: number;
  name: string;
  allocationType: "percentage" | "fixed_amount";
  value: string;
  amount: number; // resolved £ amount, computed once at creation via allocateAmounts
  expectedTotalAmount: string;
  status: "pending" | "complete" | "billed";
  xeroInvoiceId: string | null;
  completedAt: Date | null;
  billedAt: Date | null;
};

export async function setJobClientName(tenantId: string, jobId: string, clientName: string): Promise<void> {
  await withTenant(tenantId, null, (tx) =>
    tx
      .update(jobs)
      .set({ clientName, updatedAt: new Date() })
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId))),
  );
}

/** A job with no children — the only valid target for a milestone schedule (Addendum 2.K). */
export async function isLeafJob(tenantId: string, jobId: string): Promise<boolean> {
  return withTenant(tenantId, null, async (tx) => {
    const [child] = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.parentId, jobId)).limit(1);
    return !child;
  });
}

/**
 * Walks up from jobId to find the nearest clientName (own node first, then
 * ancestors root-to-leaf order reversed to leaf-to-root) — a leaf job billed
 * under a client set higher up the tree doesn't need its own copy.
 */
export async function resolveClientName(tenantId: string, jobId: string): Promise<string | null> {
  return withTenant(tenantId, null, async (tx) => {
    const [job] = await tx.select({ clientName: jobs.clientName }).from(jobs).where(eq(jobs.id, jobId));
    if (job?.clientName) return job.clientName;

    const ancestors = await getJobAncestors(tx, tenantId, jobId);
    // getJobAncestors orders root-first; walk nearest-first (reverse).
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const [ancestor] = await tx
        .select({ clientName: jobs.clientName })
        .from(jobs)
        .where(eq(jobs.id, ancestors[i].id));
      if (ancestor?.clientName) return ancestor.clientName;
    }
    return null;
  });
}

export async function getMilestonesForJob(tenantId: string, jobId: string): Promise<MilestoneRow[]> {
  const rows = await withTenant(tenantId, null, (tx) =>
    tx.select().from(milestones).where(and(eq(milestones.tenantId, tenantId), eq(milestones.jobId, jobId))).orderBy(asc(milestones.sequence)),
  );
  if (rows.length === 0) return [];
  const amounts = resolveMilestoneAmounts(rows);
  return rows.map((r, i) => ({ ...r, amount: amounts[i] }));
}

/**
 * Creates a job's full milestone schedule in one shot — Addendum 2.K:
 * "sum of all milestones for a job must equal exactly 100% / the full
 * contract value", so this validates and rejects rather than accepting a
 * schedule that can never be completed correctly. Refuses if the job
 * already has any milestones (edit-by-delete-and-recreate, not a partial
 * patch — same reasoning as allocation_lines never accepting a partial fix).
 */
export async function createMilestoneSchedule(
  tenantId: string,
  jobId: string,
  input: {
    allocationType: "percentage" | "fixed_amount";
    expectedTotalAmount: number;
    rows: { name: string; value: number }[];
  },
): Promise<void> {
  if (!(await isLeafJob(tenantId, jobId))) {
    throw new Error("Milestones can only be set on a job with no sub-jobs (the lowest level in the tree).");
  }
  if (input.rows.length === 0) throw new Error("Add at least one milestone.");
  if (input.expectedTotalAmount <= 0) throw new Error("Contract value must be greater than zero.");

  const clientName = await resolveClientName(tenantId, jobId);
  if (!clientName) {
    throw new Error("Set a client name on this job (or a parent job) before creating a milestone schedule.");
  }

  const sum = input.rows.reduce((total, r) => total + r.value, 0);
  const expected = input.allocationType === "percentage" ? 100 : input.expectedTotalAmount;
  if (Math.abs(sum - expected) > ROUNDING_TOLERANCE) {
    const unit = input.allocationType === "percentage" ? "%" : "";
    throw new Error(
      `Milestones must sum to exactly ${expected}${unit} — got ${sum}${unit}. Adjust the values and try again.`,
    );
  }

  await withTenant(tenantId, null, (tx) =>
    tx.insert(milestones).values(
      input.rows.map((row, i) => ({
        tenantId,
        jobId,
        sequence: i + 1,
        name: row.name,
        allocationType: input.allocationType,
        value: row.value.toFixed(2),
        expectedTotalAmount: input.expectedTotalAmount.toFixed(2),
      })),
    ),
  );
}

/** Resolved £ amount for a single milestone — uses allocateAmounts so a
 * percentage-based schedule's line amounts sum exactly to the contract
 * value (Addendum 2.O's rounding rule), computed consistently rather than
 * each row rounding independently. */
export function resolveMilestoneAmounts(
  rows: Pick<MilestoneRow, "allocationType" | "value" | "expectedTotalAmount">[],
): number[] {
  if (rows.length === 0) return [];
  if (rows[0].allocationType === "fixed_amount") return rows.map((r) => Number(r.value));
  const total = Number(rows[0].expectedTotalAmount);
  const weights = rows.map((r) => Number(r.value) / 100);
  return allocateAmounts(total, weights);
}

export async function markMilestoneComplete(tenantId: string, milestoneId: string): Promise<void> {
  await withTenant(tenantId, null, (tx) =>
    tx
      .update(milestones)
      .set({ status: "complete", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(milestones.tenantId, tenantId), eq(milestones.id, milestoneId), eq(milestones.status, "pending"))),
  );
}

/**
 * Addendum 2.K: strict sequential billing by default — can't invoice a
 * later milestone before an earlier one. Returns the blocking milestone
 * (or null if billing is allowed) rather than throwing — callers that want
 * to fail loudly (a manual "create invoice" click) can throw off the
 * result themselves; callers that want to fail quietly (auto-bill on
 * complete, where "not yet its turn" is an expected, non-error outcome)
 * can just check it.
 */
export async function getSequentialBillingBlocker(
  tenantId: string,
  milestoneId: string,
): Promise<{ sequence: number; name: string } | null> {
  return withTenant(tenantId, null, async (tx) => {
    const [target] = await tx.select().from(milestones).where(and(eq(milestones.tenantId, tenantId), eq(milestones.id, milestoneId)));
    if (!target) throw new Error("Milestone not found.");

    const [earlierUnbilled] = await tx
      .select({ sequence: milestones.sequence, name: milestones.name })
      .from(milestones)
      .where(
        and(
          eq(milestones.tenantId, tenantId),
          eq(milestones.jobId, target.jobId),
          sql`${milestones.sequence} < ${target.sequence}`,
          sql`${milestones.status} != 'billed'`,
        ),
      )
      .orderBy(asc(milestones.sequence))
      .limit(1);

    return earlierUnbilled ?? null;
  });
}

export async function assertSequentialBillingAllowed(tenantId: string, milestoneId: string): Promise<void> {
  const blocker = await getSequentialBillingBlocker(tenantId, milestoneId);
  if (blocker) {
    throw new Error(`Can't invoice this milestone before "${blocker.name}" (#${blocker.sequence}) has been billed.`);
  }
}

export async function markMilestoneBilled(tenantId: string, milestoneId: string, xeroInvoiceId: string): Promise<void> {
  await withTenant(tenantId, null, (tx) =>
    tx
      .update(milestones)
      .set({ status: "billed", billedAt: new Date(), xeroInvoiceId, updatedAt: new Date() })
      .where(and(eq(milestones.tenantId, tenantId), eq(milestones.id, milestoneId))),
  );
}

export async function getMilestoneWithJob(tenantId: string, milestoneId: string) {
  return withTenant(tenantId, null, async (tx) => {
    const [row] = await tx
      .select({
        id: milestones.id,
        jobId: milestones.jobId,
        jobCode: jobs.code,
        name: milestones.name,
        status: milestones.status,
        allocationType: milestones.allocationType,
        value: milestones.value,
        expectedTotalAmount: milestones.expectedTotalAmount,
        sequence: milestones.sequence,
      })
      .from(milestones)
      .innerJoin(jobs, eq(jobs.id, milestones.jobId))
      .where(and(eq(milestones.tenantId, tenantId), eq(milestones.id, milestoneId)));
    return row ?? null;
  });
}

/** Every leaf job — the candidate list for "create a milestone schedule". */
export async function listLeafJobs(tenantId: string) {
  return withTenant(tenantId, null, async (tx) => {
    const rows = await tx
      .select({ id: jobs.id, code: jobs.code, name: jobs.name, clientName: jobs.clientName })
      .from(jobs)
      .where(and(eq(jobs.tenantId, tenantId), sql`not exists (select 1 from jobs c where c.parent_id = ${jobs.id})`))
      .orderBy(asc(jobs.code));
    return rows;
  });
}

// ---------- Billing settings ----------

export function getBillingSettings(tenantId: string) {
  return withTenant(tenantId, null, async (tx) => {
    const [row] = await tx.select().from(billingSettings).where(eq(billingSettings.tenantId, tenantId));
    return row ?? null;
  });
}

export async function upsertBillingSettings(
  tenantId: string,
  input: { salesAccountCode?: string | null; autoCreateDraftInvoiceOnComplete: boolean; gpMarginAlertThresholdPct: number },
): Promise<void> {
  await withTenant(tenantId, null, (tx) =>
    tx
      .insert(billingSettings)
      .values({
        tenantId,
        salesAccountCode: input.salesAccountCode ?? null,
        autoCreateDraftInvoiceOnComplete: input.autoCreateDraftInvoiceOnComplete,
        gpMarginAlertThresholdPct: input.gpMarginAlertThresholdPct.toFixed(2),
      })
      .onConflictDoUpdate({
        target: billingSettings.tenantId,
        set: {
          salesAccountCode: input.salesAccountCode ?? null,
          autoCreateDraftInvoiceOnComplete: input.autoCreateDraftInvoiceOnComplete,
          gpMarginAlertThresholdPct: input.gpMarginAlertThresholdPct.toFixed(2),
          updatedAt: new Date(),
        },
      }),
  );
}
