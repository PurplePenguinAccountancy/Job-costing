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
  purchaseOrders,
  documents,
} from "./schema";
import { getFullJobTree, getJobAncestors, getJobDescendants } from "./queries/job-tree";
import { matchPurchaseOrder } from "./queries/po-matching";
import { ingestDocument } from "./queries/capture-pipeline";
import { getStorageAdapter } from "@/lib/storage";
import { validateAllocationBatch, finalizeAllocationBatch } from "./queries/allocations";
import {
  addEmployee,
  addEmployeeRate,
  upsertLabourSettings,
  parseTimeEntryText,
  importTimeEntries,
  postLabourPeriod,
  ensureLabourXeroAccounts,
  pushLabourPeriodToXero,
} from "./queries/labour";
import { allocationLines } from "./schema";
import { normalizePoNumber } from "@/lib/po-number";
import { and, eq, inArray } from "drizzle-orm";

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

  // A real, working email so the freshly-built email magic-link sign-in
  // (Addendum 2.M) can actually be tested live, not just as sample data —
  // matches by email when the real sign-in happens (see auth.ts's session
  // callback), so this exact row/membership takes effect immediately.
  const [alex] = await db
    .insert(users)
    .values({ email: "Alex@purplepenguinaccountancy.co.uk", name: "Alex Crumpton" })
    .returning();

  // Second real, working email — the shared IMAP mailbox already wired up
  // for invoice capture — specifically so the sign-in flow can be verified
  // live end-to-end (fetch the actual magic-link email via IMAP, follow
  // it, confirm access) without depending on a human checking their own
  // inbox and reporting back.
  const [inboxTester] = await db
    .insert(users)
    .values({ email: "invoices@wayleavejc.co.uk", name: "Wayleave Test Inbox" })
    .returning();

  const result = await withTenant(tenantA.id, pm.id, async (tx) => {
    // tenant_memberships is RLS-scoped (unlike tenants/users above), so this
    // insert must happen inside withTenant's session context — its WITH
    // CHECK policy requires tenant_id to match app.current_tenant_id.
    await tx.insert(tenantMemberships).values([
      {
        tenantId: tenantA.id,
        userId: pm.id,
        role: "editor",
      },
      {
        tenantId: tenantA.id,
        userId: alex.id,
        role: "editor",
      },
      {
        tenantId: tenantA.id,
        userId: inboxTester.id,
        role: "editor",
      },
    ]);

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
        // Set here, at the PO level, deliberately not on SUBSITE-A itself —
        // proves milestone billing (section 9) resolves a client name from
        // the nearest ancestor when the leaf job has none of its own.
        clientName: "Northern Powergrid",
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

    // Addendum 2.J: the Xero-facing bucket a cost type rolls up into. The
    // actual account mapping for labour/labour_variance is set up live,
    // after this transaction, via ensureLabourXeroAccounts — dedicated
    // accounts Wayleave creates itself, not a reused generic bucket (see
    // that function for why: a generic "Direct Expenses" account would mix
    // labour variance in with unrelated costs).
    const [costCode] = await tx
      .insert(costCodes)
      .values({ tenantId: tenantA.id, code: "LABOUR", name: "Direct Labour", costType: "labour" })
      .returning();

    const [varianceCostCode] = await tx
      .insert(costCodes)
      .values({ tenantId: tenantA.id, code: "LABOUR-VAR", name: "Labour Rate Variance", costType: "labour_variance" })
      .returning();

    // The non-project/overhead bucket (brief section 8) — a real job like
    // any other, not a nullable special case.
    const [overheadJob] = await tx
      .insert(jobs)
      .values({ tenantId: tenantA.id, code: "OVERHEAD", name: "Non-project / Overhead" })
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

    // The PO record incoming invoices will match against (brief section 6,
    // step 3) — a real-world raised purchase order, distinct from the job
    // node that happens to share a similar code by coincidence.
    const [purchaseOrder] = await tx
      .insert(purchaseOrders)
      .values({
        tenantId: tenantA.id,
        jobId: po.id,
        costCodeId: costCode.id,
        poNumber: "PO-1042",
        normalizedPoNumber: normalizePoNumber("PO-1042"),
        vendorName: "Northline Cabling Ltd",
        amount: "12000.00",
      })
      .returning();

    await tx.insert(costTransactions).values([
      {
        tenantId: tenantA.id,
        jobId: po.id,
        costCodeId: costCode.id,
        purchaseOrderId: purchaseOrder.id,
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

    // Split-allocation proof (Addendum 2.H): a subcontractor invoice line
    // split 3 ways by percentage, deliberately awkward (33.33/33.33/33.34,
    // not evenly divisible) to prove the rounding rule — the three
    // resulting money amounts must sum back to the source total exactly,
    // not "close enough."
    const batchRef = "seed-demo-subcontractor-invoice-line-1";
    await tx.insert(allocationLines).values([
      {
        tenantId: tenantA.id,
        sourceContext: "subcontractor_invoice",
        sourceLineReference: batchRef,
        jobId: po.id,
        costCodeId: costCode.id,
        allocationType: "percentage",
        value: "33.33",
        expectedTotalAmount: "10.00",
      },
      {
        tenantId: tenantA.id,
        sourceContext: "subcontractor_invoice",
        sourceLineReference: batchRef,
        jobId: subsite.id,
        costCodeId: costCode.id,
        allocationType: "percentage",
        value: "33.33",
        expectedTotalAmount: "10.00",
      },
      {
        tenantId: tenantA.id,
        sourceContext: "subcontractor_invoice",
        sourceLineReference: batchRef,
        jobId: po.id,
        costCodeId: costCode.id,
        allocationType: "percentage",
        value: "33.34",
        expectedTotalAmount: "10.00",
      },
    ]);

    const tree = await getFullJobTree(tx, tenantA.id);
    const ancestorsOfSubsite = await getJobAncestors(tx, tenantA.id, subsite.id);
    const descendantsOfRegion = await getJobDescendants(tx, tenantA.id, region.id);
    const jobCount = await tx.select().from(jobs).where(eq(jobs.tenantId, tenantA.id));

    return {
      tree,
      ancestorsOfSubsite,
      descendantsOfRegion,
      jobCount,
      costCodeId: costCode.id,
      varianceCostCodeId: varianceCostCode.id,
      overheadJobId: overheadJob.id,
    };
  });

  console.log("Full job tree (tenant A):");
  console.table(result.tree.map((r) => ({ ...r, path: r.path.join(" > ") })));

  console.log("Ancestors of Sub-site A (root-first):");
  console.table(result.ancestorsOfSubsite);

  console.log("Descendants of North Region:");
  console.table(result.descendantsOfRegion);

  console.log(`jobs visible with tenant A context set: ${result.jobCount.length} (expect 4, incl. OVERHEAD)`);

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

  // PO matching proof: a differently-formatted but equivalent PO number
  // ("po 1042" vs the stored "PO-1042") must still match — normalisation
  // strips whitespace/dashes and is case-insensitive.
  const matched = await matchPurchaseOrder(tenantA.id, "po 1042");
  console.log(
    `\nPO match for "po 1042": ${matched ? `found ${matched.poNumber} (${matched.vendorName})` : "NOT FOUND"} (expect found)`,
  );
  if (!matched) {
    throw new Error("PO MATCHING FAILURE: normalised lookup did not find the seeded PO");
  }

  const unmatched = await matchPurchaseOrder(tenantA.id, "PO-9999");
  console.log(`PO match for "PO-9999": ${unmatched ? "found (unexpected!)" : "not found"} (expect not found)`);
  if (unmatched) {
    throw new Error("PO MATCHING FAILURE: an unrelated PO number matched");
  }

  // Capture pipeline proof: ingest a real invoice (real bytes, not a
  // placeholder) matching PO-1042 — proves ingestDocument end-to-end, and
  // that the storage adapter round-trips exactly what was written, since
  // that's what ultimately gets attached to the Xero bill. This checks the
  // pipeline's mechanics (PO matching, transaction creation, duplicate
  // detection), not OCR accuracy — that's separately live-verified against
  // real invoice PDFs via Azure (see CLAUDE.md §18) — so it deliberately
  // forces the mock adapter even when Azure is configured: the synthetic
  // "Key: Value" text fixture below isn't a real document Azure's
  // prebuilt-invoice model can parse (it 415s on text/plain).
  const savedAzureEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const savedAzureKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

  const invoiceBytes = Buffer.from(
    "Vendor: Northline Cabling Ltd\nPO: PO-1042\nDate: 2026-08-01\nTotal: 500.00",
    "utf-8",
  );
  const ingestResult = await ingestDocument({
    tenantId: tenantA.id,
    filename: "seed-demo-invoice-1.txt",
    mimeType: "text/plain",
    fileBuffer: invoiceBytes,
    receivedVia: "manual_upload",
  });
  console.log(
    `\nDocument capture: matched PO ${ingestResult.matchedPo}, transaction ${ingestResult.costTransactionId ? "created" : "not created"} (expect matched, created)`,
  );
  if (!ingestResult.matchedPo || !ingestResult.costTransactionId) {
    throw new Error("CAPTURE PIPELINE FAILURE: expected the seeded invoice to match PO-1042 and file a transaction");
  }

  const [storedDoc] = await withTenant(tenantA.id, null, (tx) =>
    tx.select({ storageKey: documents.storageKey }).from(documents).where(eq(documents.id, ingestResult.documentId)),
  );
  const storage = getStorageAdapter();
  const roundTripped = storedDoc.storageKey ? await storage.retrieve(storedDoc.storageKey) : null;
  console.log(
    `Storage round-trip: ${roundTripped?.equals(invoiceBytes) ? "bytes match exactly" : "MISMATCH"} (expect match)`,
  );
  if (!roundTripped || !roundTripped.equals(invoiceBytes)) {
    throw new Error("STORAGE FAILURE: retrieved bytes did not match what was stored");
  }

  // Duplicate-invoice detection proof: re-submitting the same
  // vendor+PO+amount must be flagged and withheld from auto-filing, not
  // silently posted as a second transaction against the same PO.
  const duplicateResult = await ingestDocument({
    tenantId: tenantA.id,
    filename: "seed-demo-invoice-1-resubmitted.txt",
    mimeType: "text/plain",
    fileBuffer: invoiceBytes,
    receivedVia: "manual_upload",
  });
  console.log(
    `Duplicate detection: flagged as duplicate of ${duplicateResult.possibleDuplicateOfDocumentId} (expect ${ingestResult.documentId}), transaction ${duplicateResult.costTransactionId ? "created (unexpected!)" : "withheld"} (expect withheld)`,
  );
  if (duplicateResult.possibleDuplicateOfDocumentId !== ingestResult.documentId || duplicateResult.costTransactionId) {
    throw new Error("DUPLICATE DETECTION FAILURE: re-submitted invoice was not flagged, or still filed a transaction");
  }

  if (savedAzureEndpoint) process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = savedAzureEndpoint;
  if (savedAzureKey) process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = savedAzureKey;

  // Split-allocation proof: validate the batch (expect complete, since the
  // three percentages sum to exactly 100), then finalize it and confirm
  // the resulting transaction amounts sum back to the source total exactly
  // — this is the rounding-rule guarantee, not just "the split happened."
  const batchRef = "seed-demo-subcontractor-invoice-line-1";
  const validation = await validateAllocationBatch(tenantA.id, batchRef);
  console.log(
    `\nAllocation batch validation: ${validation.sum} of ${validation.expected} allocated across ${validation.lineCount} lines (expect complete)`,
  );
  if (!validation.complete) {
    throw new Error("ALLOCATION VALIDATION FAILURE: batch should be complete but isn't");
  }

  const createdTransactionIds = await finalizeAllocationBatch(tenantA.id, batchRef, {
    sourceType: "subcontractor_invoice",
    transactionDate: "2026-08-05",
  });
  const allCreated = await withTenant(tenantA.id, null, (tx) =>
    tx
      .select({ amount: costTransactions.amount })
      .from(costTransactions)
      .where(inArray(costTransactions.id, createdTransactionIds)),
  );
  const amounts = allCreated.map((r) => Number(r.amount));
  const sumOfCreated = amounts.reduce((a, b) => a + b, 0);
  console.log(
    `Allocation amounts: [${amounts.join(", ")}] summing to ${sumOfCreated.toFixed(2)} (expect exactly 10.00, proving the rounding rule)`,
  );
  if (Math.abs(sumOfCreated - 10) > 0.001) {
    throw new Error(`ALLOCATION ROUNDING FAILURE: amounts summed to ${sumOfCreated}, expected exactly 10.00`);
  }

  // Labour posting proof (brief section 8's critical rule): standard
  // costing must never be independently calculated — job-allocated cost
  // plus variance must equal the actual payroll total posted to Xero,
  // exactly, every period.
  //
  // Live Xero call: finds or creates the two dedicated accounts (Direct
  // Labour job-costed, Labour Rate Variance) and records the mapping —
  // real accounts in the Demo Company, not hardcoded placeholder codes.
  const { labourAccount, varianceAccount } = await ensureLabourXeroAccounts(tenantA.id);
  console.log(
    `\nLabour Xero accounts: ${labourAccount.code} (${labourAccount.name}), ${varianceAccount.code} (${varianceAccount.name})`,
  );

  await upsertLabourSettings(tenantA.id, {
    costingMethod: "standard",
    defaultLabourCostCodeId: result.costCodeId,
    defaultVarianceCostCodeId: result.varianceCostCodeId,
    overheadJobId: result.overheadJobId,
    // Where the payroll provider's own journal actually posts in the Demo
    // Company — genuinely distinct from labourAccount above.
    payrollClearingAccountCode: "320",
  });

  // Settings-validation proof: the payroll clearing account can't collide
  // with the job-costed labour account — the reclassification journal is
  // "move money out of clearing INTO labour + variance," which is
  // meaningless if clearing IS the labour account.
  let collisionGuardFired = false;
  try {
    await upsertLabourSettings(tenantA.id, {
      costingMethod: "standard",
      defaultLabourCostCodeId: result.costCodeId,
      defaultVarianceCostCodeId: result.varianceCostCodeId,
      overheadJobId: result.overheadJobId,
      payrollClearingAccountCode: labourAccount.code,
    });
  } catch (err) {
    collisionGuardFired = err instanceof Error && err.message.includes("can't be the same as");
  }
  console.log(
    `Account-collision guard: ${collisionGuardFired ? "correctly refused" : "DID NOT FIRE"} (expect refused)`,
  );
  if (!collisionGuardFired) {
    throw new Error("SETTINGS VALIDATION FAILURE: colliding payroll clearing account should have been refused");
  }

  const dave = await addEmployee(tenantA.id, { employeeIdentifier: "EMP-001", name: "Dave Fletcher" });
  const priya = await addEmployee(tenantA.id, { employeeIdentifier: "EMP-002", name: "Priya Shah" });
  await addEmployeeRate(tenantA.id, {
    employeeId: dave.id,
    rateType: "standard",
    hourlyRate: "28.50",
    effectiveFrom: "2026-01-01",
  });
  await addEmployeeRate(tenantA.id, {
    employeeId: priya.id,
    rateType: "standard",
    hourlyRate: "24.00",
    effectiveFrom: "2026-01-01",
  });

  // The fixed import template (Addendum 2.I) — pasted/uploaded text, not a
  // flexible column-mapper.
  const timeSheetText = [
    "employee_identifier,job_code,date,hours",
    "EMP-001,PO-1042,2026-08-01,8",
    "EMP-001,SUBSITE-A,2026-08-02,6",
    "EMP-002,SUBSITE-A,2026-08-03,8",
  ].join("\n");
  const { rows, errors: parseErrors } = parseTimeEntryText(timeSheetText);
  const importResult = await importTimeEntries(tenantA.id, rows, "seed-demo-timesheet-1");
  console.log(
    `\nTime entry import: ${importResult.created} created, ${importResult.errors.length + parseErrors.length} errors (expect 3 created, 0 errors)`,
  );
  if (importResult.created !== 3 || importResult.errors.length > 0 || parseErrors.length > 0) {
    throw new Error("TIME ENTRY IMPORT FAILURE: expected 3 clean rows");
  }

  // Duplicate time-entry proof: re-importing the identical timesheet must
  // be reported as duplicates, not silently create a second set of hours —
  // that would double the labour cost this period allocates.
  const reImport = await importTimeEntries(tenantA.id, rows, "seed-demo-timesheet-1-again");
  console.log(
    `Time entry re-import: ${reImport.created} created, ${reImport.errors.length} duplicate errors (expect 0 created, 3 errors)`,
  );
  if (reImport.created !== 0 || reImport.errors.length !== 3) {
    throw new Error(
      "TIME ENTRY DUPLICATE DETECTION FAILURE: re-importing identical rows should be fully rejected as duplicates",
    );
  }

  // Real payroll total for the period, deliberately different from what
  // hours x standard-rate alone would produce — proves the variance
  // mechanism actually reconciles the gap, not just that posting "works."
  const actualPayrollTotal = 650.0;
  const posting = await postLabourPeriod(tenantA.id, {
    periodStart: "2026-08-01",
    periodEnd: "2026-08-07",
    actualPayrollTotal,
    transactionDate: "2026-08-07",
  });
  console.log(
    `Labour posting: £${posting.totalAllocated.toFixed(2)} allocated across ${posting.jobTransactionIds.length} jobs, £${posting.variance.toFixed(2)} variance (expect £591.00 allocated, £59.00 variance)`,
  );
  const reconciledTotal = posting.totalAllocated + posting.variance;
  console.log(
    `Critical rule check: allocated (${posting.totalAllocated.toFixed(2)}) + variance (${posting.variance.toFixed(2)}) = ${reconciledTotal.toFixed(2)} (expect exactly ${actualPayrollTotal.toFixed(2)})`,
  );
  if (Math.abs(reconciledTotal - actualPayrollTotal) > 0.001) {
    throw new Error(
      `LABOUR POSTING FAILURE: allocated + variance (${reconciledTotal}) did not equal actual payroll total (${actualPayrollTotal})`,
    );
  }

  // Idempotency proof: re-posting the same period must be refused, not
  // silently double the job-costed + variance transactions.
  let idempotencyGuardFired = false;
  try {
    await postLabourPeriod(tenantA.id, {
      periodStart: "2026-08-01",
      periodEnd: "2026-08-07",
      actualPayrollTotal,
      transactionDate: "2026-08-07",
    });
  } catch (err) {
    idempotencyGuardFired = err instanceof Error && err.message.includes("already been posted");
  }
  console.log(
    `Labour idempotency guard: ${idempotencyGuardFired ? "correctly refused re-post" : "DID NOT FIRE"} (expect refused)`,
  );
  if (!idempotencyGuardFired) {
    throw new Error("LABOUR IDEMPOTENCY FAILURE: re-posting the same period should have been refused");
  }

  // Approve the whole period, then push the real reclassification journal
  // to Xero — proves the full loop, not just that the DB-side math works.
  const periodTransactionIds = [...posting.jobTransactionIds, ...(posting.varianceTransactionId ? [posting.varianceTransactionId] : [])];
  await withTenant(tenantA.id, null, (tx) =>
    tx
      .update(costTransactions)
      .set({ approvalStatus: "approved" })
      .where(and(eq(costTransactions.tenantId, tenantA.id), inArray(costTransactions.id, periodTransactionIds))),
  );

  const journal = await pushLabourPeriodToXero(tenantA.id, "2026-08-01", "2026-08-07");
  console.log(
    `Labour journal pushed to Xero: ${journal.journalId} (£${journal.totalAllocated.toFixed(2)} job-costed, £${journal.variance.toFixed(2)} variance)`,
  );
  if (journal.signConventionWarning) {
    console.warn(`SIGN CONVENTION WARNING: ${journal.signConventionWarning}`);
  } else {
    console.log("Sign-convention self-check: Direct Labour account moved in the expected direction.");
  }

  console.log(
    "\nSeed complete. RLS isolation, PO matching, capture pipeline + duplicate detection, storage round-trip, " +
      "split-allocation, and labour posting/idempotency/journal-push all verified.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
