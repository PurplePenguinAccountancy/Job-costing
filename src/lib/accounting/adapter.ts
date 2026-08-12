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

export type Contact = {
  id: string;
  name: string;
};

export type BillLineItem = {
  description: string;
  /** Platform account code — not a Wayleave cost code. Callers resolve
   * cost_type_accounts to this before calling createBill. */
  accountCode: string;
  amount: number;
};

export type JournalLine = {
  accountCode: string;
  /** Signed: positive = debit, negative = credit. All lines across a
   * journal must net to exactly zero. */
  amount: number;
  description?: string;
};

/**
 * An account's net movement for a period, as reported by the platform's
 * own books — this is the "Xero side" of the reconciliation comparison in
 * Addendum 2.C. Positive = net debit (the normal balance for a Cost of
 * Sales/expense account).
 */
export type AccountBalance = {
  accountId: string;
  accountName: string;
  balance: number;
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

  /**
   * Every account's YTD net movement, in one call — this is what
   * reconciliation (Addendum 2.C) compares Wayleave's summed job-costing
   * total against, per cost-type account. YTD rather than all-time or
   * calendar-month: the closest available proxy to "this account's activity
   * so far" without requiring a client-specific reconciliation start date,
   * which isn't decided yet — revisit once that's chosen.
   */
  getAccountBalances(): Promise<AccountBalance[]>;

  /**
   * Matches by exact name (Addendum 2.D) — the caller decides what "no
   * match" means for its flow (flag for review vs. auto-create); this
   * method itself always creates when nothing matches, since bill push
   * cannot proceed without a contact to bill against.
   */
  findOrCreateContact(name: string): Promise<Contact>;

  /**
   * Posts a fully-coded, already-approved bill (Addendum 1.A — approval
   * happens in Wayleave before this is ever called, so the bill is created
   * authorised/posted in Xero, not a draft awaiting a second review there).
   */
  createBill(input: {
    contactId: string;
    date: string;
    /** Defaults to `date` if omitted — Xero requires a due date on any
     * AUTHORISED bill, but Wayleave doesn't model payment terms yet. */
    dueDate?: string;
    reference?: string;
    lineItems: BillLineItem[];
  }): Promise<{ id: string }>;

  /**
   * Attaches the original source document to an already-created bill (brief
   * section 4 — every transaction pushed to Xero must carry its backing
   * document, the audit-trail differentiator).
   */
  attachFileToBill(
    billId: string,
    fileName: string,
    mimeType: string,
    content: Buffer,
  ): Promise<void>;

  /**
   * Posts a manual journal — used for the labour standard-costing
   * reclassification (Dr job-costed Direct Labour, Dr/Cr Labour Rate
   * Variance, Cr the payroll clearing account). Lines must net to zero;
   * implementations should reject (not silently correct) an unbalanced set.
   */
  createManualJournal(input: {
    date: string;
    narration: string;
    lines: JournalLine[];
  }): Promise<{ id: string }>;
}
