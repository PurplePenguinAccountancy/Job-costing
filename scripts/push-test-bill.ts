import "dotenv/config";
import { XeroAdapter } from "../src/lib/accounting/xero-adapter";
import { getTenantReconciliation } from "../src/db/queries/reconciliation";
import { db, withTenant } from "../src/db";
import { costTransactions, tenants } from "../src/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Proves createBill/attachFileToBill work end-to-end against the Demo
 * Company, and that the reconciliation check genuinely reacts to real
 * state — not just trivially reporting "balanced" at zero. Pushes one real
 * bill matching the seeded SUBSITE-A actual transaction (£3,500, Direct
 * Labour), checks reconciliation BEFORE marking it posted (expect a real
 * mismatch — Xero now has it, Wayleave hasn't recorded the sync yet), then
 * marks it posted and checks again (expect balanced).
 */
async function main() {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.name, "Acme Civils Ltd"));
  if (!tenant) throw new Error("Seed data not found — run npm run db:seed first");

  const adapter = new XeroAdapter();
  const contact = await adapter.findOrCreateContact("Northline Cabling Ltd");
  console.log(`Contact: ${contact.name} (${contact.id})`);

  const bill = await adapter.createBill({
    contactId: contact.id,
    date: "2026-08-03",
    reference: "SUBSITE-A cabling — Aug 2026",
    lineItems: [{ description: "Direct labour — Sub-site A cabling", accountCode: "320", amount: 3500 }],
  });
  console.log(`Bill created: ${bill.id}`);

  await adapter.attachFileToBill(
    bill.id,
    "subsite-a-labour-invoice.txt",
    "text/plain",
    Buffer.from("Placeholder source document for the smoke test — a real capture-pipeline PDF would go here."),
  );
  console.log("Attachment pushed.");

  console.log("\n--- Reconciliation BEFORE marking Wayleave's transaction posted ---");
  console.table(await getTenantReconciliation(tenant.id));

  await withTenant(tenant.id, null, (tx) =>
    tx
      .update(costTransactions)
      .set({ approvalStatus: "posted", xeroReference: bill.id })
      .where(
        and(eq(costTransactions.tenantId, tenant.id), eq(costTransactions.sourceType, "bill")),
      ),
  );
  console.log("\nMarked the matching Wayleave transaction as posted.");

  console.log("\n--- Reconciliation AFTER marking it posted ---");
  console.table(await getTenantReconciliation(tenant.id));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
