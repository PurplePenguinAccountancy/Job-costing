"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createMilestoneSchedule,
  markMilestoneComplete,
  markMilestoneBilled,
  getSequentialBillingBlocker,
  getMilestonesForJob,
  getMilestoneWithJob,
  resolveClientName,
  setJobClientName,
  getBillingSettings,
  upsertBillingSettings,
} from "@/db/queries/milestones";
import { XeroAdapter } from "@/lib/accounting/xero-adapter";

// Plain top-level "use server" functions, not nested closures inside a page
// component — see team/actions.ts, which found the hard way that passing a
// page-local closure as another function's argument breaks Next.js's
// server-action serialization.
function reportError(path: string, err: unknown): never {
  if (err && typeof err === "object" && "digest" in err) throw err; // Next.js redirect/notFound signal
  const message = err instanceof Error ? err.message : "Something went wrong.";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/**
 * Creates a real Xero draft sales invoice for one milestone (Addendum
 * 2.9/2.K) — resolves the client contact, the sales account, and the
 * milestone's own resolved £ amount, then marks it billed. Shared by both
 * the auto-bill-on-complete path and the manual "create invoice" button.
 */
async function createDraftInvoiceForMilestone(tenantId: string, milestoneId: string): Promise<void> {
  const milestone = await getMilestoneWithJob(tenantId, milestoneId);
  if (!milestone) throw new Error("Milestone not found.");

  const settings = await getBillingSettings(tenantId);
  if (!settings?.salesAccountCode) {
    throw new Error("Set a sales account in billing settings before creating invoices.");
  }

  const clientName = await resolveClientName(tenantId, milestone.jobId);
  if (!clientName) throw new Error("No client name set for this job.");

  const rows = await getMilestonesForJob(tenantId, milestone.jobId);
  const row = rows.find((r) => r.id === milestoneId);
  if (!row) throw new Error("Milestone not found.");

  const adapter = new XeroAdapter();
  const contact = await adapter.findOrCreateContact(clientName);
  const invoice = await adapter.createSalesInvoice({
    contactId: contact.id,
    date: new Date().toISOString().slice(0, 10),
    reference: `${milestone.jobCode} — ${milestone.name}`,
    lineItems: [{ description: milestone.name, accountCode: settings.salesAccountCode, amount: row.amount }],
  });

  await markMilestoneBilled(tenantId, milestoneId, invoice.id);
}

export async function setClientNameAction(tenantId: string, jobId: string, formData: FormData) {
  const path = `/t/${tenantId}/billing/${jobId}`;
  try {
    const clientName = String(formData.get("clientName") || "").trim();
    if (!clientName) throw new Error("Client name is required.");
    await setJobClientName(tenantId, jobId, clientName);
  } catch (err) {
    reportError(path, err);
  }
  revalidatePath(path);
}

export async function createScheduleAction(tenantId: string, jobId: string, formData: FormData) {
  const path = `/t/${tenantId}/billing/${jobId}`;
  try {
    const allocationType = String(formData.get("allocationType")) as "percentage" | "fixed_amount";
    const expectedTotalAmount = Number(formData.get("expectedTotalAmount"));
    const names = formData.getAll("rowName").map(String);
    const values = formData.getAll("rowValue").map(String);

    const rows = names
      .map((name, i) => ({ name: name.trim(), value: Number(values[i]) }))
      .filter((r) => r.name.length > 0);

    await createMilestoneSchedule(tenantId, jobId, { allocationType, expectedTotalAmount, rows });
  } catch (err) {
    reportError(path, err);
  }
  revalidatePath(path);
  revalidatePath(`/t/${tenantId}/billing`);
}

export async function markCompleteAction(tenantId: string, jobId: string, formData: FormData) {
  const path = `/t/${tenantId}/billing/${jobId}`;
  try {
    const milestoneId = String(formData.get("milestoneId"));
    await markMilestoneComplete(tenantId, milestoneId);

    // Auto-bill is a convenience, not a guarantee — if it's not this
    // milestone's turn yet (sequential billing, Addendum 2.K) that's an
    // entirely expected outcome, not an error to surface. Any other
    // failure (no sales account mapped, Xero unreachable) is real and
    // should show up rather than fail silently.
    const settings = await getBillingSettings(tenantId);
    if (settings?.autoCreateDraftInvoiceOnComplete) {
      const blocker = await getSequentialBillingBlocker(tenantId, milestoneId);
      if (!blocker) {
        await createDraftInvoiceForMilestone(tenantId, milestoneId);
      }
    }
  } catch (err) {
    reportError(path, err);
  }
  revalidatePath(path);
  revalidatePath(`/t/${tenantId}/billing`);
}

export async function createInvoiceAction(tenantId: string, jobId: string, formData: FormData) {
  const path = `/t/${tenantId}/billing/${jobId}`;
  try {
    const milestoneId = String(formData.get("milestoneId"));
    const blocker = await getSequentialBillingBlocker(tenantId, milestoneId);
    if (blocker) {
      throw new Error(`Can't invoice this milestone before "${blocker.name}" (#${blocker.sequence}) has been billed.`);
    }
    await createDraftInvoiceForMilestone(tenantId, milestoneId);
  } catch (err) {
    reportError(path, err);
  }
  revalidatePath(path);
  revalidatePath(`/t/${tenantId}/billing`);
}

export async function saveBillingSettingsAction(tenantId: string, formData: FormData) {
  const path = `/t/${tenantId}/billing`;
  try {
    await upsertBillingSettings(tenantId, {
      salesAccountCode: String(formData.get("salesAccountCode") || "") || null,
      autoCreateDraftInvoiceOnComplete: formData.get("autoCreateDraftInvoiceOnComplete") === "on",
      gpMarginAlertThresholdPct: Number(formData.get("gpMarginAlertThresholdPct")),
    });
  } catch (err) {
    reportError(path, err);
  }
  revalidatePath(path);
}
