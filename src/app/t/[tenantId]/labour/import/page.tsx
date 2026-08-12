import Link from "next/link";
import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { parseTimeEntryText, importTimeEntries } from "@/db/queries/labour";
import styles from "../labour.module.css";

export default async function ImportTimeEntriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ created?: string; errors?: string; detail?: string }>;
}) {
  const { tenantId } = await params;
  const { created, errors: errorCount, detail } = await searchParams;
  const errorDetails: { line: number; raw: string; message: string }[] = detail ? JSON.parse(detail) : [];

  async function runImport(formData: FormData) {
    "use server";
    const text = String(formData.get("text") || "");
    const { rows, errors: parseErrors } = parseTimeEntryText(text);
    const result = await importTimeEntries(tenantId, rows, randomUUID());
    const allErrors = [...parseErrors, ...result.errors];

    const detailParam = allErrors.length > 0 ? `&detail=${encodeURIComponent(JSON.stringify(allErrors.slice(0, 10)))}` : "";
    redirect(`/t/${tenantId}/labour/import?created=${result.created}&errors=${allErrors.length}${detailParam}`);
  }

  return (
    <div className={styles.page}>
      <Link href={`/t/${tenantId}/labour`} className={styles.back}>
        ← Labour
      </Link>
      <h1>Import time entries</h1>
      <p className={styles.hint}>
        Fixed format only (brief section 8: &quot;not a flexible column-mapper&quot;):{" "}
        <code>employee_identifier,job_code,date,hours</code> — one row per line, header optional.
        Every row either imports or reports an error; nothing silently drops.
      </p>

      {created !== undefined && (
        <div className={Number(errorCount) > 0 ? styles.statusWarn : styles.statusOk}>
          {created} row{created === "1" ? "" : "s"} imported
          {Number(errorCount) > 0 ? `, ${errorCount} error${errorCount === "1" ? "" : "s"}` : ""}.
        </div>
      )}

      {errorDetails.length > 0 && (
        <ul className={styles.errorList}>
          {errorDetails.map((e, i) => (
            <li key={i}>
              Line {e.line}: {e.message} — <span className={styles.mono}>{e.raw}</span>
            </li>
          ))}
        </ul>
      )}

      <form action={runImport} className={styles.form}>
        <textarea
          name="text"
          rows={8}
          className={styles.textarea}
          defaultValue={
            "employee_identifier,job_code,date,hours\nEMP-001,PO-1042,2026-08-08,8\nEMP-002,SUBSITE-A,2026-08-08,7.5"
          }
        />
        <button type="submit" className={styles.submit}>
          Import
        </button>
      </form>
    </div>
  );
}
