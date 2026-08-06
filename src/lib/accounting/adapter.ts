/**
 * Platform-agnostic accounting integration surface (brief section 4). Xero
 * is the only implementation for MVP, but nothing here may be Xero-shaped —
 * QuickBooks, Sage, FreeAgent, and Dynamics all have genuinely different
 * data models and capability ceilings, and FreeAgent in particular has far
 * fewer job-costing hooks than Xero or Dynamics. Every method here must
 * stay generic enough that a new adapter can implement it without this
 * interface changing shape.
 */

export type AccountingCapability =
  | "trackingCategories"
  | "attachments"
  | "manualJournals"
  | "profitAndLossReport"
  | "trialBalanceReport";

export type AccountingCapabilities = {
  /** Whether this platform supports each capability at all. */
  supports: Record<AccountingCapability, boolean>;
  /**
   * Xero-specific ceilings (2 active categories, ~100 options each, 1 on
   * payroll transactions) — deliberately optional so a platform with no
   * such ceiling (or a different one entirely) isn't forced to fake a
   * number. Callers must treat "undefined" as "no known limit", not zero.
   */
  maxTrackingCategories?: number;
  maxOptionsPerTrackingCategory?: number;
  maxTrackingCategoriesOnPayrollTransactions?: number;
};

export type TrackingCategory = {
  id: string;
  name: string;
  options: { id: string; name: string }[];
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
   * This product's own database is the permanent source of truth for the
   * job hierarchy (brief section 4) — this call only reads whatever
   * flattened structure the platform itself can hold, e.g. Xero's tracking
   * categories, never the other way round.
   */
  listTrackingCategories(): Promise<TrackingCategory[]>;

  /**
   * Ensures a tracking option exists for the given flattened job reference
   * (a job code or concatenated path — the hierarchy never fits inside a
   * platform's own category structure). Creates the option if missing,
   * returns the existing one otherwise. Throws if the category itself
   * doesn't exist yet or is already at the platform's option-count ceiling
   * — this method deliberately never creates the category itself, since on
   * Xero that consumes one of only two scarce top-level slots and must be a
   * deliberate setup choice, not an automatic side effect of allocating cost.
   */
  ensureTrackingCategoryOption(
    categoryName: string,
    optionName: string,
  ): Promise<{ categoryId: string; optionId: string }>;
}
