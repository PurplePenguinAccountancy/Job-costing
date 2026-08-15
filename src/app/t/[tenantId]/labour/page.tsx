import Link from "next/link";
import { revalidatePath } from "next/cache";
import {
  getLabourSettings,
  upsertLabourSettings,
  listEmployees,
  listEmployeeRates,
  addEmployee,
  addEmployeeRate,
  ensureLabourXeroAccounts,
  getLabourAccountMappings,
} from "@/db/queries/labour";
import { listJobsForAllocation, listCostCodesForAllocation } from "@/db/queries/approvals";
import { XeroAdapter } from "@/lib/accounting/xero-adapter";
import styles from "./labour.module.css";

export default async function LabourPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [settings, employees, rates, allJobs, allCostCodes, mappings] = await Promise.all([
    getLabourSettings(tenantId),
    listEmployees(tenantId),
    listEmployeeRates(tenantId),
    listJobsForAllocation(tenantId),
    listCostCodesForAllocation(tenantId),
    getLabourAccountMappings(tenantId),
  ]);

  let xeroAccounts: Awaited<ReturnType<XeroAdapter["listCostOfSalesAccounts"]>> = [];
  let xeroError: string | null = null;
  try {
    xeroAccounts = await new XeroAdapter().listCostOfSalesAccounts();
  } catch (err) {
    xeroError = err instanceof Error ? err.message : String(err);
  }

  const labourMapping = mappings.find((m) => m.costType === "labour");
  const varianceMapping = mappings.find((m) => m.costType === "labour_variance");

  async function saveSettings(formData: FormData) {
    "use server";
    await upsertLabourSettings(tenantId, {
      costingMethod: String(formData.get("costingMethod")) as "actual" | "standard",
      defaultLabourCostCodeId: String(formData.get("defaultLabourCostCodeId")),
      defaultVarianceCostCodeId: String(formData.get("defaultVarianceCostCodeId")),
      overheadJobId: String(formData.get("overheadJobId")),
      payrollClearingAccountCode: String(formData.get("payrollClearingAccountCode") || "") || null,
    });
    revalidatePath(`/t/${tenantId}/labour`);
  }

  async function setUpXeroAccounts() {
    "use server";
    await ensureLabourXeroAccounts(tenantId);
    revalidatePath(`/t/${tenantId}/labour`);
  }

  async function createEmployee(formData: FormData) {
    "use server";
    await addEmployee(tenantId, {
      employeeIdentifier: String(formData.get("employeeIdentifier")),
      name: String(formData.get("name")),
    });
    revalidatePath(`/t/${tenantId}/labour`);
  }

  async function createRate(formData: FormData) {
    "use server";
    await addEmployeeRate(tenantId, {
      employeeId: String(formData.get("employeeId")),
      rateType: String(formData.get("rateType")) as "actual" | "standard",
      hourlyRate: String(formData.get("hourlyRate")),
      effectiveFrom: String(formData.get("effectiveFrom")),
    });
    revalidatePath(`/t/${tenantId}/labour`);
  }

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        <h1>Labour</h1>
        <div className={styles.titleActions}>
          <Link href={`/t/${tenantId}/labour/import`} className={styles.navLink}>
            Import time entries
          </Link>
          <Link href={`/t/${tenantId}/labour/post`} className={styles.navLink}>
            Post labour period
          </Link>
        </div>
      </div>
      <p className={styles.hint}>
        Direct labour costing only (brief section 8) — no time-clock, no scheduling. Standard
        costing: fixed rates now, actual costing (rate recalculated monthly) not yet built —
        schema supports it, the posting logic below is standard-only for now.
      </p>

      <section>
        <h2>Settings</h2>
        <p className={styles.hint}>
          One costing method per tenant, not mixed per transaction. The overhead job is where
          unallocated time and the rate variance land — a real job, not a special case.
        </p>
        <form action={saveSettings} className={styles.grid}>
          <label className={styles.field}>
            Costing method
            <select name="costingMethod" defaultValue={settings?.costingMethod ?? "standard"}>
              <option value="standard">Standard (fixed rate)</option>
              <option value="actual">Actual (not yet implemented)</option>
            </select>
          </label>
          <label className={styles.field}>
            Labour cost code
            <select name="defaultLabourCostCodeId" defaultValue={settings?.defaultLabourCostCodeId ?? ""}>
              <option value="" disabled>
                Select
              </option>
              {allCostCodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Variance cost code
            <select name="defaultVarianceCostCodeId" defaultValue={settings?.defaultVarianceCostCodeId ?? ""}>
              <option value="" disabled>
                Select
              </option>
              {allCostCodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Overhead job
            <select name="overheadJobId" defaultValue={settings?.overheadJobId ?? ""}>
              <option value="" disabled>
                Select
              </option>
              {allJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} — {j.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Payroll clearing account{" "}
            <span className={styles.optional}>(where the payroll provider actually posts)</span>
            <select name="payrollClearingAccountCode" defaultValue={settings?.payrollClearingAccountCode ?? ""}>
              <option value="">Not set</option>
              {xeroAccounts.map((a) => (
                <option key={a.id} value={a.code}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={styles.submit}>
            Save settings
          </button>
        </form>
      </section>

      <section>
        <h2>Xero accounts</h2>
        <p className={styles.hint}>
          The job-costed Direct Labour and Labour Rate Variance accounts are dedicated accounts
          Wayleave creates itself (Addendum 2.J) — not a generic expense bucket that would mix
          variance in with unrelated costs. Safe to run again; it only creates what&apos;s missing.
        </p>
        {xeroError ? (
          <p className={styles.statusWarn}>Xero unavailable: {xeroError}</p>
        ) : (
          <ul className={styles.mappingList}>
            <li>
              Direct Labour (job-costed):{" "}
              <span className={styles.mono}>
                {labourMapping ? `${labourMapping.xeroAccountCode} (mapped)` : "not set up yet"}
              </span>
            </li>
            <li>
              Labour Rate Variance:{" "}
              <span className={styles.mono}>
                {varianceMapping ? `${varianceMapping.xeroAccountCode} (mapped)` : "not set up yet"}
              </span>
            </li>
          </ul>
        )}
        <form action={setUpXeroAccounts}>
          <button type="submit" className={styles.addButton}>
            Set up Xero accounts
          </button>
        </form>
      </section>

      <section>
        <h2>Employees ({employees.length})</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Identifier</th>
              <th>Name</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td className={styles.mono}>{e.employeeIdentifier}</td>
                <td>{e.name}</td>
                <td>{e.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={createEmployee} className={styles.inlineForm}>
          <input name="employeeIdentifier" placeholder="Identifier (e.g. EMP-003)" required />
          <input name="name" placeholder="Full name" required />
          <button type="submit" className={styles.addButton}>
            Add employee
          </button>
        </form>
      </section>

      <section>
        <h2>Rates ({rates.length})</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Type</th>
              <th className={styles.num}>Hourly rate</th>
              <th>Effective from</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id}>
                <td>{r.employeeName}</td>
                <td>{r.rateType}</td>
                <td className={styles.num}>
                  {Number(r.hourlyRate).toLocaleString("en-GB", { style: "currency", currency: "GBP" })}
                </td>
                <td>{r.effectiveFrom}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={createRate} className={styles.inlineForm}>
          <select name="employeeId" required defaultValue="">
            <option value="" disabled>
              Employee
            </option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.employeeIdentifier} — {e.name}
              </option>
            ))}
          </select>
          <select name="rateType" defaultValue="standard">
            <option value="standard">Standard</option>
            <option value="actual">Actual</option>
          </select>
          <input name="hourlyRate" type="number" step="0.01" placeholder="£/hour" required />
          <input name="effectiveFrom" type="date" required />
          <button type="submit" className={styles.addButton}>
            Add rate
          </button>
        </form>
      </section>
    </div>
  );
}
