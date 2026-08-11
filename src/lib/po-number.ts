/**
 * Addendum 2.G: exact match only, post-normalisation — strip whitespace/
 * dashes/leading zeros, case-insensitive. No fuzzy auto-linking for PO
 * identity, ever: a confident-but-wrong fuzzy match would misallocate cost
 * to the wrong job while keeping aggregate totals balanced, which the
 * reconciliation check has no way to catch.
 *
 * Shared by both PO creation (purchase_orders.normalizedPoNumber) and
 * incoming-document matching, so the two can never drift apart.
 */
export function normalizePoNumber(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/^0+(?=\d)/, "");
}
