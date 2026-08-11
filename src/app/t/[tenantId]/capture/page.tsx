import Link from "next/link";
import { redirect } from "next/navigation";
import { ingestDocument } from "@/db/queries/capture-pipeline";
import styles from "./capture.module.css";

export default async function CapturePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  async function simulate(formData: FormData) {
    "use server";
    const filename = String(formData.get("filename") || "invoice.txt");
    const content = String(formData.get("content") || "");

    await ingestDocument({
      tenantId,
      filename,
      mimeType: "text/plain",
      fileBuffer: Buffer.from(content, "utf-8"),
      receivedVia: "manual_upload",
    });

    redirect(`/t/${tenantId}/approvals`);
  }

  return (
    <div className={styles.page}>
      <Link href={`/t/${tenantId}`} className={styles.back}>
        ← Dashboard
      </Link>
      <h1>Simulate incoming document</h1>
      <p className={styles.hint}>
        Dev-only stand-in for real email/upload intake — no OCR account is connected yet
        (Addendum 2.G), so this feeds the mock extraction adapter directly. Paste content the same
        shape a real OCR result would produce: <code>Vendor</code>, <code>PO</code>,{" "}
        <code>Date</code>, <code>Total</code> as &quot;Key: Value&quot; lines. Try changing the PO
        number to one that doesn&apos;t exist to see the no-match path.
      </p>

      <form action={simulate} className={styles.form}>
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
