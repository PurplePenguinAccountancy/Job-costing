import { redirect } from "next/navigation";
import { ingestDocument, checkInboxForNewInvoices } from "@/db/queries/capture-pipeline";
import styles from "./capture.module.css";

export default async function CapturePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ inboxChecked?: string; messages?: string; attachments?: string }>;
}) {
  const { tenantId } = await params;
  const { inboxChecked, messages, attachments } = await searchParams;

  async function simulate(formData: FormData) {
    "use server";
    const uploadedFile = formData.get("file") as File | null;
    const content = String(formData.get("content") || "");
    const manualFilename = String(formData.get("filename") || "invoice.txt");

    let fileBuffer: Buffer;
    let filename: string;
    let mimeType: string;

    if (uploadedFile && uploadedFile.size > 0) {
      // The real path — once Azure Document Intelligence is connected,
      // this is exactly what a real captured PDF/image goes through.
      fileBuffer = Buffer.from(await uploadedFile.arrayBuffer());
      filename = uploadedFile.name;
      mimeType = uploadedFile.type || "application/octet-stream";
    } else {
      // Dev-only fallback — feeds the mock extraction adapter directly.
      fileBuffer = Buffer.from(content, "utf-8");
      filename = manualFilename;
      mimeType = "text/plain";
    }

    await ingestDocument({ tenantId, filename, mimeType, fileBuffer, receivedVia: "manual_upload" });
    redirect(`/t/${tenantId}/approvals`);
  }

  async function checkInbox() {
    "use server";
    const result = await checkInboxForNewInvoices(tenantId);
    redirect(
      `/t/${tenantId}/capture?inboxChecked=1&messages=${result.messagesChecked}&attachments=${result.attachmentsIngested}`,
    );
  }

  return (
    <div className={styles.page}>
      <section>
        <h1>Check inbox</h1>
        <p className={styles.hint}>
          Real inbound email, forwarded through <code>invoices@wayleavejc.co.uk</code> (IMAP
          polling — dev/pilot stand-in for the real SES route in Addendum 2.N, which needs an AWS
          account that doesn&apos;t exist yet). Every attachment found goes through the same{" "}
          <code>ingestDocument</code> pipeline as a manual upload. Single shared test mailbox for
          now — every attachment is attributed to this tenant.
        </p>
        {inboxChecked ? (
          <p className={styles.hint}>
            Last check: {messages} message(s) found, {attachments} attachment(s) ingested.
          </p>
        ) : null}
        <form action={checkInbox}>
          <button type="submit" className={styles.submit}>
            Check invoices@wayleavejc.co.uk now
          </button>
        </form>
      </section>

      <div className={styles.divider}>— or simulate an incoming document without real email —</div>

      <h1>Simulate incoming document</h1>
      <p className={styles.hint}>
        Dev-only stand-in for testing extraction without sending a real email. Upload a real file
        if Azure Document Intelligence is connected (Addendum 2.G) — otherwise leave it blank and
        use the text fallback below, which feeds the mock extraction adapter directly:{" "}
        <code>Vendor</code>, <code>PO</code>, <code>Date</code>, <code>Total</code> as &quot;Key:
        Value&quot; lines. Try a PO number that doesn&apos;t exist to see the no-match path.
      </p>

      <form action={simulate} className={styles.form} encType="multipart/form-data">
        <label className={styles.field}>
          Upload a real file (optional)
          <input type="file" name="file" className={styles.input} />
        </label>

        <div className={styles.divider}>— or, for a quick test without a real file —</div>

        <label className={styles.field}>
          Filename
          <input name="filename" defaultValue="invoice-northline-aug.txt" className={styles.input} />
        </label>
        <label className={styles.field}>
          Document content
          <textarea
            name="content"
            rows={6}
            defaultValue={"Vendor: Northline Cabling Ltd\nPO: PO-1042\nDate: 2026-08-09\nTotal: 1200.00"}
            className={styles.textarea}
          />
        </label>
        <button type="submit" className={styles.submit}>
          Ingest document
        </button>
      </form>
    </div>
  );
}
