import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db";
import { costCodes, costTransactions, costTypeAccounts } from "@/db/schema";
import { XeroAdapter } from "@/lib/accounting/xero-adapter";

export type ReconciliationRow = {
  costType: string;
  xeroAccountCode: string;
  xeroAccountName: string;
  isWayleaveManaged: boolean;
  wayleaveTotal: number;
  xeroBalance: number;
  difference: number;
  status: "balanced" | "mismatch" | "config_error";
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Addendum 2.C — for every cost-type account in use, Wayleave's summed
 * job-costing total must equal the Xero GL balance for that account. Only
 * `actual` + `posted` transactions count: committed cost never reaches
 * Xero's GL at all, and anything not yet posted hasn't synced yet either —
 * comparing those would manufacture false mismatches (the same "cry wolf"
 * risk the brief warns about for payroll reconciliation specifically,
 * generalised here to every cost type).
 */
export async function getTenantReconciliation(tenantId: string): Promise<ReconciliationRow[]> {
  const mappings = await withTenant(tenantId, null, (tx) =>
    tx.select().from(costTypeAccounts).where(eq(costTypeAccounts.tenantId, tenantId)),
  );
  if (mappings.length === 0) return [];

  const wayleaveTotals = await withTenant(tenantId, null, (tx) =>
    tx
      .select({
        costType: costCodes.costType,
        total: sql<string>`coalesce(sum(${costTransactions.amount}), 0)`,
      })
      .from(costTransactions)
      .innerJoin(costCodes, eq(costCodes.id, costTransactions.costCodeId))
      .where(
        and(
          eq(costTransactions.tenantId, tenantId),
          eq(costTransactions.type, "actual"),
          eq(costTransactions.approvalStatus, "posted"),
        ),
      )
      .groupBy(costCodes.costType),
  );
  const wayleaveByType = new Map(wayleaveTotals.map((r) => [r.costType, Number(r.total)]));

  const adapter = new XeroAdapter();
  const [accounts, balances] = await Promise.all([
    adapter.listCostOfSalesAccounts(),
    adapter.getAccountBalances(),
  ]);
  const codeToId = new Map(accounts.map((a) => [a.code, a.id]));
  const nameByCode = new Map(accounts.map((a) => [a.code, a.name]));
  const balanceById = new Map(balances.map((b) => [b.accountId, b.balance]));

  return mappings.map((m) => {
    const wayleaveTotal = wayleaveByType.get(m.costType) ?? 0;
    const accountId = codeToId.get(m.xeroAccountCode);
    // The mapped code not resolving to a real Xero account is a setup
    // problem, distinct from "resolves fine, just zero YTD activity" (a
    // perfectly valid state — plenty of accounts sit at zero for months).
    const configError = !accountId;
    const xeroBalance = accountId ? (balanceById.get(accountId) ?? 0) : 0;
    const difference = round2(wayleaveTotal - xeroBalance);

    return {
      costType: m.costType,
      xeroAccountCode: m.xeroAccountCode,
      xeroAccountName: nameByCode.get(m.xeroAccountCode) ?? m.xeroAccountCode,
      isWayleaveManaged: m.isWayleaveManaged,
      wayleaveTotal,
      xeroBalance,
      difference,
      status: configError ? "config_error" : Math.abs(difference) < 0.01 ? "balanced" : "mismatch",
    };
  });
}
