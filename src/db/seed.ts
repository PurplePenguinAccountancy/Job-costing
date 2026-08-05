import "dotenv/config";
import { db, withTenant } from "./index";
import {
  tenants,
  users,
  tenantMemberships,
  jobs,
  costCodes,
  budgets,
  costTransactions,
} from "./schema";
import { getFullJobTree, getJobAncestors, getJobDescendants } from "./queries/job-tree";
import { eq } from "drizzle-orm";

/**
 * Seeds one sample tenant with a 3-level job tree (matching the brief's
 * Region -> PO -> sub-site example) and exercises the things that must
 * work: cost posted on a non-leaf node, recursive tree queries, and RLS
 * actually blocking cross-tenant reads. Not a full fixture set — just
 * enough to prove the schema holds together.
 */
async function main() {
  // Seeding runs outside withTenant() because it creates the tenant itself
  // (tenants isn't RLS-scoped) and needs elevated table access — connect as
  // app_user is still required (never as postgres), but no tenant context
  // exists yet for tenants/users, which have no RLS policy restricting them.

  const [tenantA] = await db.insert(tenants).values({ name: "Acme Civils Ltd" }).returning();
  const [tenantB] = await db.insert(tenants).values({ name: "Other Contractor Ltd" }).returning();

  const [pm] = await db
    .insert(users)
    .values({ email: "pm@acmecivils.example", name: "Sam Rivera" })
    .returning();

  const result = await withTenant(tenantA.id, pm.id, async (tx) => {
    // tenant_memberships is RLS-scoped (unlike tenants/users above), so this
    // insert must happen inside withTenant's session context — its WITH
    // CHECK policy requires tenant_id to match app.current_tenant_id.
    await tx.insert(tenantMemberships).values({
      tenantId: tenantA.id,
      userId: pm.id,
      role: "editor",
    });

    const [region] = await tx
      .insert(jobs)
      .values({ tenantId: tenantA.id, code: "REGION-NORTH", name: "North Region", ownerId: pm.id })
      .returning();

    const [po] = await tx
      .insert(jobs)
      .values({
        tenantId: tenantA.id,
        parentId: region.id,
        code: "PO-1042",
        name: "PO 1042 - Substation Works",
        ownerId: pm.id,
      })
      .returning();

    const [subsite] = await tx
      .insert(jobs)
      .values({
        tenantId: tenantA.id,
        parentId: po.id,
        code: "SUBSITE-A",
        name: "Sub-site A - Cabling",
      })
      .returning();

    const [costCode] = await tx
      .insert(costCodes)
      .values({ tenantId: tenantA.id, code: "LABOUR", name: "Direct Labour" })
      .returning();

    // Cost posted directly on the PO node (not a leaf) — proves the "any
    // node, not just leaves" rule holds without a dummy child.
    await tx.insert(budgets).values({
      tenantId: tenantA.id,
      jobId: po.id,
      costCodeId: costCode.id,
      amount: "50000.00",
      source: "manual",
    });

    await tx.insert(costTransactions).values([
      {
        tenantId: tenantA.id,
        jobId: po.id,
        costCodeId: costCode.id,
        type: "committed",
        amount: "12000.00",
        sourceType: "subcontractor_invoice",
        transactionDate: "2026-08-01",
        createdBy: pm.id,
      },
      {
        tenantId: tenantA.id,
        jobId: subsite.id,
        costCodeId: costCode.id,
        type: "actual",
        amount: "3500.00",
        sourceType: "bill",
        transactionDate: "2026-08-03",
        createdBy: pm.id,
        approvalStatus: "approved",
        approvedBy: pm.id,
      },
    ]);

    const tree = await getFullJobTree(tx, tenantA.id);
    const ancestorsOfSubsite = await getJobAncestors(tx, tenantA.id, subsite.id);
    const descendantsOfRegion = await getJobDescendants(tx, tenantA.id, region.id);
    const jobCount = await tx.select().from(jobs).where(eq(jobs.tenantId, tenantA.id));

    return { tree, ancestorsOfSubsite, descendantsOfRegion, jobCount };
  });

  console.log("Full job tree (tenant A):");
  console.table(result.tree.map((r) => ({ ...r, path: r.path.join(" > ") })));

  console.log("Ancestors of Sub-site A (root-first):");
  console.table(result.ancestorsOfSubsite);

  console.log("Descendants of North Region:");
  console.table(result.descendantsOfRegion);

  console.log(`jobs visible with tenant A context set: ${result.jobCount.length} (expect 3)`);

  // RLS proof: querying jobs with tenant B's context set must return zero
  // rows for tenant A's jobs, even though they're in the same physical table.
  const crossTenantAttempt = await withTenant(tenantB.id, null, async (tx) => {
    return tx.select().from(jobs);
  });
  console.log(
    `jobs visible with tenant B context set: ${crossTenantAttempt.length} (expect 0 - RLS isolation check)`,
  );

  if (crossTenantAttempt.length !== 0) {
    throw new Error("RLS ISOLATION FAILURE: tenant B could see tenant A's jobs");
  }

  console.log("\nSeed complete. RLS isolation verified.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
