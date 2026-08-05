import { and, desc, eq, sql } from "drizzle-orm";
import { db, withTenant } from "@/db";
import { budgets, costCodes, costTransactions, jobs as jobsTable, tenants, users } from "@/db/schema";
import { getFullJobTree, type JobTreeRow } from "./job-tree";

export async function listTenants() {
  // tenants carries no RLS policy (see schema/tenants.ts) — it's the row
  // that defines a tenant, not data scoped to one.
  return db.select().from(tenants).orderBy(tenants.name);
}

export type JobRollup = JobTreeRow & {
  ownerName: string | null;
  budgetTotal: string;
  committedTotal: string;
  actualTotal: string;
};

export type TenantDashboard = {
  tenantName: string;
  jobs: JobRollup[];
  costCodes: { id: string; code: string; name: string }[];
  transactions: {
    id: string;
    jobCode: string;
    costCodeName: string;
    type: string;
    amount: string;
    approvalStatus: string;
    sourceType: string;
    transactionDate: string;
    description: string | null;
  }[];
};

export async function getTenantDashboard(tenantId: string): Promise<TenantDashboard> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw new Error("Tenant not found");

  return withTenant(tenantId, null, async (tx) => {
    const tree = await getFullJobTree(tx, tenantId);

    const owners = await tx
      .select({ jobId: jobsTable.id, ownerName: users.name })
      .from(jobsTable)
      .leftJoin(users, eq(jobsTable.ownerId, users.id))
      .where(eq(jobsTable.tenantId, tenantId));
    const ownerByJobId = new Map(owners.map((o) => [o.jobId, o.ownerName]));

    const budgetRows = await tx
      .select({ jobId: budgets.jobId, total: sql<string>`coalesce(sum(${budgets.amount}), 0)` })
      .from(budgets)
      .where(eq(budgets.tenantId, tenantId))
      .groupBy(budgets.jobId);
    const budgetByJobId = new Map(budgetRows.map((r) => [r.jobId, r.total]));

    const committedRows = await tx
      .select({
        jobId: costTransactions.jobId,
        total: sql<string>`coalesce(sum(${costTransactions.amount}), 0)`,
      })
      .from(costTransactions)
      .where(and(eq(costTransactions.tenantId, tenantId), eq(costTransactions.type, "committed")))
      .groupBy(costTransactions.jobId);
    const committedByJobId = new Map(committedRows.map((r) => [r.jobId, r.total]));

    const actualRows = await tx
      .select({
        jobId: costTransactions.jobId,
        total: sql<string>`coalesce(sum(${costTransactions.amount}), 0)`,
      })
      .from(costTransactions)
      .where(and(eq(costTransactions.tenantId, tenantId), eq(costTransactions.type, "actual")))
      .groupBy(costTransactions.jobId);
    const actualByJobId = new Map(actualRows.map((r) => [r.jobId, r.total]));

    const jobs: JobRollup[] = tree.map((job) => ({
      ...job,
      ownerName: ownerByJobId.get(job.id) ?? null,
      budgetTotal: budgetByJobId.get(job.id) ?? "0",
      committedTotal: committedByJobId.get(job.id) ?? "0",
      actualTotal: actualByJobId.get(job.id) ?? "0",
    }));

    const codes = await tx
      .select({ id: costCodes.id, code: costCodes.code, name: costCodes.name })
      .from(costCodes)
      .where(eq(costCodes.tenantId, tenantId))
      .orderBy(costCodes.code);

    const txRows = await tx
      .select({
        id: costTransactions.id,
        jobCode: jobsTable.code,
        costCodeName: costCodes.name,
        type: costTransactions.type,
        amount: costTransactions.amount,
        approvalStatus: costTransactions.approvalStatus,
        sourceType: costTransactions.sourceType,
        transactionDate: costTransactions.transactionDate,
        description: costTransactions.description,
      })
      .from(costTransactions)
      .innerJoin(jobsTable, eq(jobsTable.id, costTransactions.jobId))
      .innerJoin(costCodes, eq(costCodes.id, costTransactions.costCodeId))
      .where(eq(costTransactions.tenantId, tenantId))
      .orderBy(desc(costTransactions.transactionDate));

    return { tenantName: tenant.name, jobs, costCodes: codes, transactions: txRows };
  });
}
