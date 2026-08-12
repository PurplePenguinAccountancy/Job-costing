import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db";
import { costTransactions, costCodes, costTypeAccounts, purchaseOrders, documents } from "@/db/schema";
import {
  getPendingReview,
  getApprovedNotPosted,
  getUnallocatedDocuments,
  listJobsForAllocation,
  listCostCodesForAllocation,
} from "@/db/queries/approvals";
import { XeroAdapter } from "@/lib/accounting/xero-adapter";
import styles from "./approvals.module.css";

function formatMoney(value: string) {
  return Number(value).toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

export default async function ApprovalsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [pending, approved, unallocated, allJobs, allCostCodes] = await Promise.all([
    getPendingReview(tenantId),
    getApprovedNotPosted(tenantId),
    getUnallocatedDocuments(tenantId),
    listJobsForAllocation(tenantId),
    listCostCodesForAllocation(tenantId),
  ]);

  // Addendum 1.A: a simple, present approval step, with a fast bulk-approve
  // path so this doesn't become a bottleneck — nothing here posts to Xero
  // by itself, approving only moves a row to "approved"; syncing is a
  // separate, explicit action below.
  async function approveSelected(formData: FormData) {
    "use server";
    const ids = formData.getAll("ids").map(String);
    if (ids.length === 0) return;

    await withTenant(tenantId, null, (tx) =>
      tx
        .update(costTransactions)
        .set({ approvalStatus: "approved", approvedAt: new Date() })
        .where(and(eq(costTransactions.tenantId, tenantId), inArray(costTransactions.id, ids))),
    );
    revalidatePath(`/t/${tenantId}/approvals`);
  }

  // The actual Xero sync — reuses the exact adapter methods proved out
  // against the Demo Company (createBill/attachFileToBill), now wired to
  // real approved rows instead of a one-off script.
  async function pushToXero(formData: FormData) {
    "use server";
    const transactionId = String(formData.get("transactionId"));

    const [row] = await withTenant(tenantId, null, (tx) =>
      tx
        .select({
          id: costTransactions.id,
          amount: costTransactions.amount,
          type: costTransactions.type,
          costType: costCodes.costType,
          transactionDate: costTransactions.transactionDate,
          vendorName: purchaseOrders.vendorName,
          filename: documents.filename,
        })
        .from(costTransactions)
        .innerJoin(costCodes, eq(costCodes.id, costTransactions.costCodeId))
        .leftJoin(purchaseOrders, eq(purchaseOrders.id, costTransactions.purchaseOrderId))
        .leftJoin(documents, eq(documents.id, costTransactions.documentId))
        .where(and(eq(costTransactions.tenantId, tenantId), eq(costTransactions.id, transactionId))),
    );
    if (!row) return;
    if (row.type !== "actual") {
      // Belt-and-braces: getApprovedNotPosted already excludes these, but
      // this form action is the actual enforcement point — committed cost
      // (a PO raised, not yet invoiced) must never become a Xero bill.
      throw new Error(
        `Refusing to push a "${row.type}" transaction to Xero — only actual (invoiced) cost may sync.`,
      );
    }

    const [mapping] = await withTenant(tenantId, null, (tx) =>
      tx
        .select()
        .from(costTypeAccounts)
        .where(and(eq(costTypeAccounts.tenantId, tenantId), eq(costTypeAccounts.costType, row.costType))),
    );
    if (!mapping) {
      throw new Error(`No Xero account mapped for cost type "${row.costType}" — set one up before syncing.`);
    }

    const adapter = new XeroAdapter();
    const contact = await adapter.findOrCreateContact(row.vendorName ?? "Unknown supplier");
    const bill = await adapter.createBill({
      contactId: contact.id,
      date: row.transactionDate,
      reference: row.filename ?? undefined,
      lineItems: [
        {
          description: row.filename ?? "Cost transaction",
          accountCode: mapping.xeroAccountCode,
          amount: Number(row.amount),
        },
      ],
    });
    await adapter.attachFileToBill(
      bill.id,
      row.filename ?? "document.txt",
      "text/plain",
      Buffer.from(`Wayleave cost transaction ${row.id} — synced from the approval queue.`),
    );

    await withTenant(tenantId, null, (tx) =>
      tx
        .update(costTransactions)
        .set({ approvalStatus: "posted", xeroReference: bill.id })
        .where(eq(costTransactions.id, transactionId)),
    );
    revalidatePath(`/t/${tenantId}/approvals`);
    revalidatePath(`/t/${tenantId}`);
  }

  // Addendum 2.G: no PO match (or nothing usable extracted) doesn't mean
  // the document disappears — it sits here until a human allocates it
  // directly. Still always lands in pending_approval afterward, same as
  // every other entry point (Addendum 1.A).
  async function manuallyAllocate(formData: FormData) {
    "use server";
    const documentId = String(formData.get("documentId"));
    const jobId = String(formData.get("jobId"));
    const costCodeId = String(formData.get("costCodeId"));
    const amount = String(formData.get("amount"));
    const transactionDate = String(formData.get("transactionDate"));

    if (!jobId || !costCodeId || !amount || !transactionDate) {
      throw new Error("Job, cost code, amount, and date are all required to allocate a document.");
    }

    await withTenant(tenantId, null, (tx) =>
      tx.insert(costTransactions).values({
        tenantId,
        jobId,
        costCodeId,
        documentId,
        type: "actual",
        amount,
        approvalStatus: "pending_approval",
        sourceType: "bill",
        transactionDate,
      }),
    );
    revalidatePath(`/t/${tenantId}/approvals`);
  }

  return (
    <div className={styles.page}>
      <Link href={`/t/${tenantId}`} className={styles.back}>
        ← Dashboard
      </Link>
      <h1>Cost approval queue</h1>
      <p className={styles.hint}>
        Nothing posts to Xero unchecked (Addendum 1.A) — every bill, bank line, or subcontractor
        split passes through here first.
      </p>

      <section>
        <h2>Pending review ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className={styles.empty}>Nothing waiting on review.</p>
        ) : (
          <form action={approveSelected}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th></th>
                  <th>Date</th>
                  <th>Job</th>
                  <th>Cost code</th>
                  <th>Vendor</th>
                  <th className={styles.num}>Amount</th>
                  <th>Confidence</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input type="checkbox" name="ids" value={row.id} />
                    </td>
                    <td>{row.transactionDate}</td>
                    <td>
                      <span className={styles.jobCode}>{row.jobCode}</span>
                      {row.jobName}
                    </td>
                    <td>{row.costCodeName}</td>
                    <td>{row.vendorName ?? "—"}</td>
                    <td className={styles.num}>{formatMoney(row.amount)}</td>
                    <td>
                      {row.confidence
                        ? `${Math.round(Number(row.confidence) * 100)}%`
                        : "—"}
                    </td>
                    <td>
                      <span className={styles.status}>
                        {row.extractionStatus === "needs_review"
                          ? "Needs review"
                          : row.approvalStatus.replace("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="submit" className={styles.approveButton}>
              Approve selected
            </button>
          </form>
        )}
      </section>

      <section>
        <h2>Approved — ready to sync ({approved.length})</h2>
        {approved.length === 0 ? (
          <p className={styles.empty}>Nothing approved and waiting to sync.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Job</th>
                <th>Cost code</th>
                <th>Vendor</th>
                <th className={styles.num}>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {approved.map((row) => (
                <tr key={row.id}>
                  <td>{row.transactionDate}</td>
                  <td>
                    <span className={styles.jobCode}>{row.jobCode}</span>
                    {row.jobName}
                  </td>
                  <td>{row.costCodeName}</td>
                  <td>{row.vendorName ?? "—"}</td>
                  <td className={styles.num}>{formatMoney(row.amount)}</td>
                  <td>
                    <form action={pushToXero}>
                      <input type="hidden" name="transactionId" value={row.id} />
                      <button type="submit" className={styles.syncButton}>
                        Push to Xero
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Unmatched documents ({unallocated.length})</h2>
        <p className={styles.hint}>
          No PO match, or nothing usable extracted — these never silently disappear (Addendum
          2.G). Allocate each one to a job and cost code manually.
        </p>
        {unallocated.length === 0 ? (
          <p className={styles.empty}>Nothing waiting on manual allocation.</p>
        ) : (
          <div className={styles.unallocatedList}>
            {unallocated.map((doc) => (
              <form action={manuallyAllocate} key={doc.id} className={styles.unallocatedCard}>
                <input type="hidden" name="documentId" value={doc.id} />
                <div className={styles.unallocatedHeader}>
                  <strong>{doc.filename}</strong>
                  <span className={styles.status}>{doc.extractionStatus.replace("_", " ")}</span>
                </div>
                <p className={styles.hint}>
                  Extracted: {doc.extractedVendorName ?? "no vendor"} · PO{" "}
                  {doc.extractedPoNumber ?? "none"} ·{" "}
                  {doc.extractedAmount ? formatMoney(doc.extractedAmount) : "no amount"}
                  {doc.extractedPoNumber && !doc.extractedAmount ? " (PO given but no total extracted)" : ""}
                  {!doc.extractedPoNumber && doc.extractedAmount ? " (no matching PO found)" : ""}
                </p>
                <div className={styles.unallocatedFields}>
                  <label>
                    Job
                    <select name="jobId" required defaultValue="">
                      <option value="" disabled>
                        Select a job
                      </option>
                      {allJobs.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.code} — {j.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Cost code
                    <select name="costCodeId" required defaultValue="">
                      <option value="" disabled>
                        Select a cost code
                      </option>
                      {allCostCodes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Amount
                    <input
                      name="amount"
                      type="number"
                      step="0.01"
                      required
                      defaultValue={doc.extractedAmount ?? ""}
                    />
                  </label>
                  <label>
                    Date
                    <input
                      name="transactionDate"
                      type="date"
                      required
                      defaultValue={doc.extractedInvoiceDate ?? ""}
                    />
                  </label>
                </div>
                <button type="submit" className={styles.approveButton}>
                  Allocate
                </button>
              </form>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
