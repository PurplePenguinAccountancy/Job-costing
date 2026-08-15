import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { budgets, costTransactions, milestones, jobs as jobsTable, users } from "@/db/schema";
import { getFullJobTree, type JobTreeRow } from "./job-tree";
import { resolveMilestoneAmounts, getBillingSettings } from "./milestones";

/**
 * The single shared cost/billing feed behind both the WIP view (section 9)
 * and margin protection (section 10) — built once, per the brief's explicit
 * instruction not to calculate it twice. Every money figure here is a
 * SUBTREE total (this job plus every descendant), not just the job's own
 * row — "cost incurred to date... at the relevant hierarchy level" only
 * means something if a parent node reflects everything underneath it.
 */
export type JobWipRow = JobTreeRow & {
  ownerName: string | null;
  budgetTotal: number;
  committedTotal: number;
  actualTotal: number;
  contractValue: number; // sum of leaf jobs' milestone-schedule contract value in this subtree
  billedTotal: number; // sum of billed milestone amounts in this subtree
  costToDate: number; // committedTotal + actualTotal
  wipPosition: number; // billedTotal - costToDate: positive = over-billed (cash-flow risk), negative = under-billed (margin-at-risk)
  budgetedMarginPct: number | null; // (contractValue - budgetTotal) / contractValue * 100
  currentMarginPct: number | null; // (contractValue - costToDate) / contractValue * 100
  marginAlert: boolean; // budgetedMarginPct - currentMarginPct exceeds the tenant's configured threshold
};

export async function getTenantWip(tenantId: string): Promise<JobWipRow[]> {
  return withTenant(tenantId, null, async (tx) => {
    const tree = await getFullJobTree(tx, tenantId);
    const settings = await getBillingSettings(tenantId);
    const threshold = settings ? Number(settings.gpMarginAlertThresholdPct) : 5;

    const owners = await tx
      .select({ jobId: jobsTable.id, ownerName: users.name })
      .from(jobsTable)
      .leftJoin(users, eq(jobsTable.ownerId, users.id))
      .where(eq(jobsTable.tenantId, tenantId));
    const ownerByJobId = new Map(owners.map((o) => [o.jobId, o.ownerName]));

    const budgetRows = await tx
      .select({ jobId: budgets.jobId, amount: budgets.amount })
      .from(budgets)
      .where(eq(budgets.tenantId, tenantId));
    const committedRows = await tx
      .select({ jobId: costTransactions.jobId, amount: costTransactions.amount })
      .from(costTransactions)
      .where(and(eq(costTransactions.tenantId, tenantId), eq(costTransactions.type, "committed")));
    const actualRows = await tx
      .select({ jobId: costTransactions.jobId, amount: costTransactions.amount })
      .from(costTransactions)
      .where(and(eq(costTransactions.tenantId, tenantId), eq(costTransactions.type, "actual")));

    const milestoneRows = await tx.select().from(milestones).where(eq(milestones.tenantId, tenantId));
    const milestonesByJobId = new Map<string, typeof milestoneRows>();
    for (const m of milestoneRows) {
      const list = milestonesByJobId.get(m.jobId) ?? [];
      list.push(m);
      milestonesByJobId.set(m.jobId, list);
    }

    // Own-node figures only, keyed by jobId.
    const ownBudget = new Map<string, number>();
    const ownCommitted = new Map<string, number>();
    const ownActual = new Map<string, number>();
    const ownContractValue = new Map<string, number>();
    const ownBilled = new Map<string, number>();

    const addTo = (map: Map<string, number>, jobId: string, amount: number) =>
      map.set(jobId, (map.get(jobId) ?? 0) + amount);

    for (const r of budgetRows) addTo(ownBudget, r.jobId, Number(r.amount));
    for (const r of committedRows) addTo(ownCommitted, r.jobId, Number(r.amount));
    for (const r of actualRows) addTo(ownActual, r.jobId, Number(r.amount));

    for (const [jobId, rows] of milestonesByJobId) {
      const sorted = [...rows].sort((a, b) => a.sequence - b.sequence);
      ownContractValue.set(jobId, Number(sorted[0].expectedTotalAmount));
      const amounts = resolveMilestoneAmounts(sorted);
      const billed = sorted.reduce((sum, m, i) => sum + (m.status === "billed" ? amounts[i] : 0), 0);
      ownBilled.set(jobId, billed);
    }

    // Roll each job's own figures up into every ancestor-or-self. Built from
    // parentId links, not getFullJobTree's own `path` field — that path is
    // an array of job CODES (see job-tree.ts), not ids, so it can't be used
    // as a set of ancestor ids directly.
    const parentById = new Map(tree.map((j) => [j.id, j.parentId]));
    const idPathById = new Map<string, string[]>();
    for (const job of tree) {
      const chain: string[] = [];
      let current: string | null = job.id;
      while (current) {
        chain.push(current);
        current = parentById.get(current) ?? null;
      }
      idPathById.set(job.id, chain);
    }

    const rollup = new Map<string, { budget: number; committed: number; actual: number; contractValue: number; billed: number }>();
    for (const job of tree) {
      for (const ancestorId of idPathById.get(job.id)!) {
        const acc = rollup.get(ancestorId) ?? { budget: 0, committed: 0, actual: 0, contractValue: 0, billed: 0 };
        acc.budget += ownBudget.get(job.id) ?? 0;
        acc.committed += ownCommitted.get(job.id) ?? 0;
        acc.actual += ownActual.get(job.id) ?? 0;
        acc.contractValue += ownContractValue.get(job.id) ?? 0;
        acc.billed += ownBilled.get(job.id) ?? 0;
        rollup.set(ancestorId, acc);
      }
    }

    return tree.map((job): JobWipRow => {
      const acc = rollup.get(job.id) ?? { budget: 0, committed: 0, actual: 0, contractValue: 0, billed: 0 };
      const costToDate = acc.committed + acc.actual;
      const wipPosition = acc.billed - costToDate;
      const budgetedMarginPct = acc.contractValue > 0 ? ((acc.contractValue - acc.budget) / acc.contractValue) * 100 : null;
      const currentMarginPct = acc.contractValue > 0 ? ((acc.contractValue - costToDate) / acc.contractValue) * 100 : null;
      const marginAlert =
        budgetedMarginPct !== null && currentMarginPct !== null && budgetedMarginPct - currentMarginPct > threshold;

      return {
        ...job,
        ownerName: ownerByJobId.get(job.id) ?? null,
        budgetTotal: acc.budget,
        committedTotal: acc.committed,
        actualTotal: acc.actual,
        contractValue: acc.contractValue,
        billedTotal: acc.billed,
        costToDate,
        wipPosition,
        budgetedMarginPct,
        currentMarginPct,
        marginAlert,
      };
    });
  });
}
