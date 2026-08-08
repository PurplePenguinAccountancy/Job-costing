/**
 * Platform-agnostic accounting integration surface (brief section 4). Xero
 * is the only implementation for MVP, but nothing here may be Xero-shaped —
 * QuickBooks, Sage, FreeAgent, and Dynamics all have genuinely different
 * data models and capability ceilings, and FreeAgent in particular has far
 * fewer job-costing hooks than Xero or Dynamics. Every method here must
 * stay generic enough that a new adapter can implement it without this
 * interface changing shape.
 *
 * Addendum 2.A: this product does not use tracking categories (or any
 * platform-equivalent) for job identity — job/region detail never leaves
 * this product's own database. Every transaction posts to the client's
 * chart of accounts by cost TYPE only (materials/labour/subcontractor/
 * plant), as an aggregate figure. That's what the chart-of-accounts methods
 * below exist for: finding or creating the Cost of Sales account each cost
 * type rolls up into, per tenant.
 */

export type AccountingCapability =
  | "chartOfAccounts"
  | "attachments"
  | "manualJournals"
  | "profitAndLossReport"
  | "trialBalanceReport";

export type AccountingCapabilities = {
  /** Whether this platform supports each capability at all. */
  supports: Record<AccountingCapability, boolean>;
};

export type Account = {
  id: string;
  code: string;
  name: string;
  /** Platform-native type/class string (e.g. Xero's "DIRECTCOSTS") — shown
   * to the user during setup, not interpreted by this product. */
  type: string;
};

export type OrganisationSummary = {
  name: string;
  baseCurrency: string;
};

export interface AccountingAdapter {
  readonly platform: "xero" | "quickbooks" | "sage" | "freeagent" | "dynamics";
  readonly capabilities: AccountingCapabilities;

  getOrganisation(): Promise<OrganisationSummary>;

  /**
   * Cost-of-Sales/expense accounts in the client's chart of accounts —
   * candidates for mapping a Wayleave cost type onto (Addendum 2.B/2.J).
   * Read-only discovery; mapping itself is a Wayleave-side decision
   * (cost_type_accounts table), not something this call performs.
   */
  listCostOfSalesAccounts(): Promise<Account[]>;

  /**
   * Creates a new Cost of Sales account, used only when setup finds no
   * suitable existing account for a cost type (Addendum 2.J — Wayleave
   * creates its own default accounts, flagged as Wayleave-managed, rather
   * than assuming one already exists).
   */
  createCostOfSalesAccount(input: { code: string; name: string }): Promise<Account>;
}
