import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { purchaseOrders } from "@/db/schema";
import { normalizePoNumber } from "@/lib/po-number";

/**
 * Addendum 2.G: exact match only, post-normalisation. Returns null on no
 * match — the caller's job is to route that to a human for manual
 * allocation (brief section 6, step 4), never to guess.
 */
export async function matchPurchaseOrder(tenantId: string, rawPoNumber: string) {
  const normalized = normalizePoNumber(rawPoNumber);
  const [match] = await withTenant(tenantId, null, (tx) =>
    tx
      .select()
      .from(purchaseOrders)
      .where(
        and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.normalizedPoNumber, normalized)),
      ),
  );
  return match ?? null;
}
