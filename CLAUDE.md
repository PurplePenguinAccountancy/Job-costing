# Construction Job Costing Platform — Build Brief

**Status note:** This is the working CLAUDE.md for this project, read automatically every session. It merges the original build brief with Addendum 1 (decided after build started). Treat this as decided context, not a substitute for asking clarifying questions where something is ambiguous or a real implementation choice hasn't been made yet.

---

## 1. What this is

A UK construction job costing SaaS that syncs with Xero, for civils, EV install, road works, and cabling contractors — mid-size (10–30 concurrent jobs, 10–25 users), mixed CIS subcontractor and PAYE employed labour.

**This product does not manage scheduling, tasks, or project/customer tracking** — that's handled by Monday.com already. This product owns the cost element only: hierarchy/structure, cost capture and allocation, billing, and — above all — making sure the numbers in Xero and the numbers in job costing always agree.

Long-term intent: sell this into the market as a separate company from the founder's accountancy practice, positioned on financial rigor other construction software in this space doesn't have (documented in section 11). This is a standalone product — it does not need to follow Purple Penguin Accountancy branding, though it may borrow from it where suitable.

The pilot customer is an existing construction/civils client: mixed CIS and PAYE labour, road works/EV/cabling work, uses an external payroll provider and works from payroll extracts (not Xero Payroll).

---

## 2. Product areas (v1)

Not separately purchasable modules — pricing is tiered by feature depth (Core/Mid/Premium), not by functional area. These are the two functional areas of the codebase:

- **Project** — the hierarchy/structure container. Defines what a "job" is and how it's organised. No scheduling, no tasks.
- **Job Costing** — cost capture, allocation, billing, reconciliation. Depends on Project's structure to function.

Explicitly excluded from this build: an asset-surveying feature considered earlier — parked, not in scope.

---

## 3. Core data model

- **Recursive parent/child job hierarchy, unlimited depth.** A job is like a folder: it can hold cost directly, and it can also contain other jobs (folders) inside it. A simple flat job is just a folder with nothing nested in it — same structure, same rules, no special-casing.
- **Cost must be postable on ANY node, not just leaf nodes.** This is what makes a 1-level job and a 4-level job (Region → PO → sub-site → line item, or Building → Flat) work under identical logic, with no artificial dummy child ever required to satisfy the data model.
- Client-configurable depth per job — some clients will want deep structure (Region/PO/sub-site), some will want flat. The system should warn (not hard-block) when an action implies a lower level should exist first, but never force it.
- **Cost codes**: client-configurable, reflecting each client's own chart of accounts — not a single fixed global taxonomy. UK-based initially; design so country-specific compliance logic (CIS, VAT/DRC) is isolated behind an interface rather than baked through the core model, since international expansion is a stated future goal.
- **Budgets**: settable via manual entry, converted from an accepted quote, or imported from external estimating software — support all three.
- **Committed cost** (PO raised, not yet invoiced) tracked distinct from **actual cost** (invoiced/paid), to support 3-way matching (PO vs delivery vs invoice).
- **Job ownership (core, all tiers)**: every job supports an assigned manager/PM — a simple field/relationship on the job entity. Cheap to build now, and it's the same data needed later for PM/region reporting comparisons (phase 2). *(Addendum 1.B)*

---

## 4. Accounting platform integration — Xero for MVP, built to add others

**Xero is the only integration for MVP testing**, but build the integration layer behind an adapter/interface from day one — not Xero API calls scattered through core job costing logic — so QuickBooks, Sage, FreeAgent, and Microsoft Dynamics can be added later without restructuring anything else. Each platform has a genuinely different data model and a different capability ceiling — Xero's tracking-category limits below are Xero-specific, not universal, and FreeAgent in particular has a much simpler data model with fewer job-costing hooks natively than Xero or Dynamics. The adapter interface needs a way to represent "this platform doesn't support X" per capability, rather than assuming every platform matches what Xero can do.

**Xero-specific constraints that shape the MVP implementation:**

- ~~Xero tracking categories are capped at 2 active categories, ~100 options each — and payroll transactions support only 1 category. This means Xero can never hold the full job hierarchy. This product's own database is the permanent source of truth for the hierarchy; Xero only ever receives a flattened top-level reference (e.g. one job code or a concatenated path) tagged onto each transaction.~~ **Superseded by Addendum 2.A — Xero tracking categories are not used for job identity at all.** This product's own database is the sole source of truth for the hierarchy; Xero receives only aggregate cost-type totals, no job/region reference of any kind.
- **Xero's Accounting API has a native Attachments endpoint** (GET/POST/PUT) supporting attachments on Invoices, Bills, Purchase Orders, Credit Notes, Bank Transactions, and Manual Journals. Every transaction pushed to Xero must carry its original source document via this endpoint — this is a deliberate differentiator (competing products often push coded totals without the backing document, breaking the audit trail for an HMRC enquiry).
- Start with a **Xero custom connection** for the pilot (single org, no App Store review needed). Plan for **Xero App Partner review** before onboarding any customer beyond the pilot.
- Sync cadence: near-real-time is the ideal, but 15-minute-to-hourly batch is acceptable for v1 — don't over-engineer this early.

---

## 5. Reconciliation integrity — the core non-negotiable

This is the product's entire reason to exist. Treat it as a first-class, always-on feature, not a report:

- **Every transaction that hits Xero must have a path to job allocation** (a specific job, or an explicit non-project/overhead code) — bills, direct bank spend, manual journals, all of it. Nothing should be able to sit in Xero unaccounted for in job costing.
- **Continuous automated reconciliation check**: for every relevant account/tracking scope, the Xero GL balance must equal the job costing total for that same scope. Run this on every sync, not periodically.
- Surface this as a **persistent warning that must be resolved before proceeding** (e.g. before closing a period) — model the UX on how Xero itself surfaces bank reconciliation misalignment: visible, not buried in a report nobody opens.
- **Separate payroll-specific reconciliation**: value sitting in the payroll account vs. value allocated to jobs, flagging any gap. Distinguish "genuinely not yet processed" (a real problem) from "deliberately allocated to the non-project/overhead bucket" (legitimate, already accounted for) — collapsing these into one number will make the alert cry wolf every period once non-billable time is normal, and get ignored.

**This is also the MVP pass/fail gate** — see section 12.

**Important caveat (Addendum 1.A):** reconciliation only proves the two systems agree with each other — it says nothing about whether the number was right in the first place. A misallocated or misread transaction can post to Xero and still show as "balanced." Reconciliation integrity and pre-post approval (section 5A below) are complementary, not substitutes for each other.

---

## 5A. Sign-off / approval before anything posts to Xero — core, not tier-gated *(Addendum 1.A)*

Applies to **all three cost-entry points**: invoice capture (section 6), direct/bank spend allocation, and subcontractor split-allocation (section 7). Not just the OCR pipeline — the same misallocation risk exists on all three.

**Why this is core, not optional at lower tiers**: OCR extraction isn't perfect — a misread amount, wrong vendor match, or wrong job allocation can post straight into Xero if nothing checks it first. Letting anything post unchecked at any tier undermines the core integrity promise the whole product is built on.

**Tiering — the presence of a check is core, the workflow sophistication is what's gated:**
- **Core**: a simple, present approval step — someone reviews and approves before anything posts. Include a fast bulk-approve view for high-confidence matches so this doesn't become a bottleneck, but nothing should post silently and unchecked.
- **Mid**: confidence-based routing — high-confidence, low-value matches can auto-post; lower-confidence or larger items route for review.
- **Premium**: full configurable approval workflow — multi-level approval chains, delegation, approval rules by value/vendor/job, and a complete audit trail of who approved what.

**Data model implication**: every cost-entry record needs an approval-status field (draft → pending-approval → approved → posted) from the start, even though the full approval UI/workflow comes later with the capture pipeline. Retrofitting this status after transactions already exist is exactly the kind of thing to avoid.

---

## 6. Document capture pipeline

Do **not** try to build this on top of Hubdoc or Dext:
- Hubdoc is a closed loop — captures documents and pushes straight into Xero/QuickBooks with no public developer API to intercept or run custom logic before the sync.
- Dext has some API surface (enough for Zapier/Make automations) but it's genuinely limited for this — years-old, unresolved community requests exist for exactly this job-costing use case.

Build the capture layer natively instead:
1. **Email intake** — dedicated forwarding address per client (or per job), via Mailgun/SES-style inbound routing.
2. **Extraction** — OCR/data extraction on the incoming PDF (vendor, PO number, line items, amounts). AWS Textract `AnalyzeExpense` or Azure Document Intelligence's prebuilt invoice model are the cost-effective options (~$0.01/page) — don't reach for generic OCR APIs priced for forms/tables, they're far more expensive for no benefit here.
3. **PO matching** — extracted PO number against the job costing module's own PO records.
4. **Allocation** — per however that client has configured their cost codes/hierarchy.
5. **Approval** — see section 5A. Nothing posts unchecked.
6. **Sync to Xero** — push the coded bill with the original file attached (section 4).

**A second capture pathway is required for non-invoiced spend** — fuel cards, Amazon/eBay purchases, employee expenses, anything that hits the bank directly with no invoice. Allocate these at the bank transaction level (Xero's Spend Money/Receive Money transactions) — Xero's tracking categories apply there too, so it's the same allocation mechanism, just a different entry point. Same approval requirement applies (section 5A).

---

## 7. Subcontractor / CIS

- Standard CIS verification and deduction calculation on subcontractor bills.
- Subcontractor invoices need **both** a full-allocation option (100% to one job) and a **split-allocation** option (%/amount across multiple jobs, since subbies often work several jobs at once).
- **Build one reusable "split an amount across jobs by % or value" component** and use it for subcontractor invoices, direct/non-invoiced payments, and material/stock allocation (section 9) — these are the same underlying problem, don't build it three times.
- Same approval requirement applies (section 5A).
- Note for the roadmap (not MVP): UK CIS reform effective 6 April 2026 introduced a "knew or should have known" fraud test with immediate Gross Payment Status cancellation risk (5-year reapplication, up from 1) and mandatory nil returns. A due-diligence/audit-trail module defending GPS is a strong premium-tier differentiator — flagged here for context, not required for MVP.

---

## 8. Labour / payroll allocation

- **Direct labour costing only for v1** — overhead absorption is a separate, later consideration, explicitly not now.
- Time allocation at day/half-day/hour granularity, per employee, at their **fully-loaded cost to the business** (base pay + employer NI + pension + other on-costs).
- **Payroll-provider-agnostic.** Use a **standard, fixed import template** (not a flexible column-mapper) capturing project-level person-time only — hours/days per employee per job. **Cost is calculated inside the system from stored employee rates, not imported from the payroll extract.**
- Support **both** rate models: actual costing (rate recalculated monthly from real payroll data) and standard costing (a fixed predetermined rate), with a **variance account** capturing the difference between standard-allocated cost and actual.
- **Critical rule, don't deviate from this**: never let job-allocated labour cost be an independently-calculated figure that has to coincidentally match Xero. Take the actual total payroll cost that posts to Xero for the period and split *that exact total* across jobs using the captured time allocation — under actual costing the split IS the total by construction; under standard costing, `job-allocated labour cost + variance = actual payroll total posted to Xero`, every period, no exceptions. This is what keeps the reconciliation promise in section 5 intact for labour specifically, which is the one cost type that's derived rather than transaction-matched.
- **Do not build a time-clock / clock-in-out system.** Out of scope, different product category.
- A **non-project/overhead bucket** is required for time not allocated to any job, so total hours/cost always reconciles even when not fully job-allocated.

---

## 9. Milestone billing / WIP

- Milestone/stage billing (e.g. a 30/30/30/10 payment schedule) is defined at the **bottom (lowest child) level** of the job hierarchy.
- When a stage is marked complete: **auto-create a draft bill in Xero** (not auto-sent) for the client to review and send. Provide a toggle to disable this per client, falling back to manual allocation of externally-raised sales invoices to the project (UX similar to matching an unreconciled bank payment).
- **Live WIP view**: cost incurred to date vs. value billed to date at the relevant hierarchy level — surfacing over-billing (billed ahead of cost/progress — a cash-flow risk to flag) and under-billing (cost ahead of billing — a margin-at-risk signal). This is the same underlying cost/billing feed as margin protection (section 10) — build it once, don't calculate it twice.

Material/stock allocation (bulk purchases split by % across jobs) belongs inside this invoice-processing flow. Keep it to an **allocation layer only** — do not build inventory/stock management (goods-in/out, FIFO/WAC valuation). Support a manual split at minimum, with an integration hook for a client's existing external stock system as a later addition. Give the shared split-allocation component a generic "source" reference field now, so a future external stock feed is just another producer of allocation records, not a schema change.

---

## 10. Margin protection

- **Job costing is source of truth from Sales and Direct Costs down to Gross Profit only.** Overhead allocation below GP is explicitly out of scope for v1 — handled by the client separately, outside this product, until/unless it's built later as an add-on. Don't build a per-job overhead allocation feature now, even as an option — mixing overhead bases across jobs within one client creates exactly the kind of quiet reconciliation drift this whole product exists to prevent.
- **Depreciation is an overhead item and stays entirely outside job costing.** The statutory depreciation charge (calculated from the fixed asset register) continues to be posted in Xero exactly as it is today — this product doesn't touch it, consistent with the Sales/Direct-Costs-only scope above.
- **Decided**: charging jobs an *internal* rate for using company-owned plant/equipment (recovering that plant's cost through usage — structurally similar to labour allocation: an internal rate × usage) is a distinct feature from depreciation itself. **Confirmed as an add-on, not a core v1 feature** *(Addendum 1.C — reconfirmed)*. Worth noting for whoever builds labour allocation (section 8): if that logic is written generically enough (rate × usage, applied to a job), this add-on may end up reusing most of it rather than needing its own — not worth designing for explicitly yet, just worth keeping in mind.
- Live margin tracking (budget vs. committed + actual cost) per job, with alerting when a job's position threatens the expected GP margin — GP-margin specifically, not net margin.

---

## 11. Permissions and visibility *(Addendum 1.B)*

- The base seat model is tenant-wide: **editor** (can see and act on everything in the tenant) and **viewer** (sees everything read-only).
- **Manager-scoped real-time visibility (Mid/Premium only)**: the assigned manager/PM (job ownership field, section 3) should be able to see a real-time position view limited to their own projects.
- **Important architectural note — this is not just a UI filter.** "This manager can only see/act on the jobs they own" requires **project-level (or hierarchy-branch-level) access control** — a genuinely different and more involved permission model than tenant-wide roles. Budget this as real engineering work, not a query filter bolted onto the existing dashboard.
- No new calculation logic is required for the position data itself — it's the same live margin/WIP data (sections 9–10) already being built, just scoped to a subset of jobs the requesting user is permitted to see.
- **Build implication for RLS (section 13)**: design the row-level security model so hierarchy-branch-scoped access can be added later without restructuring, even though only tenant-wide editor/viewer ships in v1.

---

## 12. Explicitly OUT of MVP scope

Real features, correctly sequenced *after* the core reconciliation promise is proven — do not build these in v1. Where cheap, low-risk prep now genuinely makes the later addition easier, it's noted; where it doesn't, that's said plainly too rather than prepping speculatively.

- **Accruals/GRNI** — triggered by goods/service "booking in" (receipt accounting), not a calendar sweep. Optional extra, phase 2. *Prep note: this needs a "goods/service received" event as a distinct, dated status on a PO — but the 3-way match requirement in section 3 already needs that same "received" status to exist in v1. No extra prep required beyond making sure that status is properly timestamped when it's built anyway.*
- **Full external stock-system integration** — manual % split allocation is enough for MVP. *Prep note: give the shared split-allocation component (section 7) a generic "source" reference field now, so a future external stock feed is just another producer of allocation records, not a schema change.*
- **Internal plant/equipment cost recovery** — decided as an add-on, not core (section 10, Addendum 1.C).
- **NEC compensation events / early warning tracking** — strong fit for this target market (civils/road works are typically NEC contracts) but not core costing. *No prep recommended — this involves time-barred notices and approval workflows that are genuinely different in shape from cost allocation. Trying to generalise the data model for it now risks building the wrong abstraction; design it properly when it's actually scoped.*
- **AI cost-code suggestion and cost-spike anomaly detection** — a real, worthwhile differentiator once the base capture pipeline is proven; explicitly *not* AI estimating/takeoff (different product category, not this business). *Prep note: when building the capture pipeline (section 6), log the OCR-extracted vendor/description text alongside the human's final cost-code decision, in a clean structured form. Costs nothing extra now, and means real training/reference data already exists when this gets built instead of starting from zero.*
- **Reporting beyond the reconciliation views** — GP-per-job trends, board-level roll-ups, region/PM comparisons. Genuinely valuable, but phase 2: none of it is trustworthy to build until section 5's reconciliation gate passes. *Prep note: the job entity already has an "owner/PM" field (section 3) — it's a likely future reporting dimension (comparisons by PM), cheap to capture at creation time, and expensive to backfill onto historical jobs later.*
- **Multi-country/currency support** — UK-only for now. *Prep note already covered in section 3: keep CIS and other tax/compliance logic in a clearly separated service rather than interleaved through core calculations. That's the only prep worth doing now — don't build currency or multi-jurisdiction handling before it's needed.*
- **In-house payroll processing** (RTI submission, pension auto-enrolment) — parked indefinitely. *No prep recommended, deliberately. This is a different regulatory and data-liability category entirely; architecting for it now would be speculative and premature given it's not a committed roadmap item.*

---

## 13. MVP definition of done — the actual test

Before this product can be considered sellable, it must pass a **binary reconciliation test**, run against real pilot data, not synthetic happy-path data:

1. For every account/tracking scope in use, **the Xero COA balance equals the job costing total for that scope.**
2. **The Xero P&L agrees with the top-level job costing total.**

If either fails, the product doesn't work — full stop, regardless of how good anything else looks. Test specifically against the cases most likely to break this quietly, not just a clean month:
- A direct payment/bank transaction that arrived with no invoice
- A CIS deduction on a subcontractor payment
- A manual journal correction
- A job that starts mid-month

Reporting and dashboards (beyond the reconciliation and payroll-gap views in section 5) are phase 2 by design — resist building them before this gate passes.

---

## 14. Tech stack (decided)

- **PostgreSQL** — recursive CTEs handle the job tree naturally; ACID transactions matter given the reconciliation guarantees in section 5. Local dev: PostgreSQL installed natively via winget (not Docker).
- **TypeScript, Next.js** (full-stack, App Router) — one codebase, mature ecosystem, plays well with Claude Code.
- **Drizzle ORM** — chosen over Prisma for this project: migrations are plain SQL (easier to hand-write/audit RLS policies alongside schema), and better raw-SQL ergonomics for recursive CTEs and reconciliation queries.
- **Multi-tenancy via Postgres row-level security**, not application-level filtering only — the cost of getting this wrong with financial data across multiple businesses is too high. See section 11 for the hierarchy-scoped access implication.
- **UK-region hosting specifically** (AWS eu-west-2 London or Azure UK South) — not just "EU." Not yet provisioned; local dev only so far.
- A job queue (BullMQ/Redis or similar) for reconciliation checks, scheduled Xero syncs, and OCR processing — keep these out of the request/response cycle. Not yet built.
- Object storage (S3-compatible) for documents, tiered: hot storage for recent documents (under ~18 months old), cold/archive storage for older ones, to keep the 6-year UK record-retention requirement affordable. Not yet built.
- **Branding**: standalone product, does not need to follow Purple Penguin Accountancy branding. Working name: **Wayleave** (provisional — not yet fully confirmed, but in use throughout the codebase, mockups, and docs).

---

## 15. Suggested build order

1. Core data model — job tree, cost codes, transaction types *(done)*
2. Xero integration — auth *(done)*, bill/attachment creation, cost-type account mapping, reconciliation check *(in progress — see Addendum 2)*
3. Capture pipeline — email intake, OCR, PO matching, allocation, approval (section 5A)
4. Labour — time-allocation import, rate calculation, payroll reconciliation view
5. Milestone billing and the WIP/dashboard views
6. Pilot with the real client, validate against section 13, iterate

---

## 16. Addendum 2 — decisions from the v1 scoping tracker

Resolved after the core data model and initial Xero auth were built. See `docs/v1-scoping-open-questions.md` and `docs/Wayleave_V1_Scoping_Tracker.xlsx` for the full original question set — this section is the condensed, decided outcome of that tracker, folded in as the permanent record per that doc's own instructions.

### 2.A Xero posting model — no tracking categories, aggregate cost-type totals only

**Decided:** Xero tracking categories are not used for job identity at all — not even a flattened top-level reference. Every transaction posts to the client's own Cost of Sales nominal account **by cost type** (materials / labour / subcontractor / plant) as an aggregate figure only. Wayleave holds the complete job-level breakdown internally; Xero never sees it, at any level, including top-level.

**Why**: removes every Xero-side constraint (2-category cap, ~100-option cap, 1-category-on-payroll limit) from the design entirely, rather than designing around them.

**Trade-off accepted**: Xero itself shows zero job/region-level detail. Anyone needing that view must use Wayleave, not Xero reports.

**Requires**: each client's Xero COA needs proper Cost of Sales sub-account granularity by cost type. Wayleave needs a *configurable* mapping to each client's actual account structure — never a fixed assumed set of account codes.

### 2.B Cost code model — granular internally, rolls up to few Xero accounts

**Decided:** cost codes stay rich and client-configurable internally (per section 3 — this did not change). Each cost code additionally carries a **cost type** (materials / labour / subcontractor / plant) and maps many-to-one onto one of the client's Xero Cost of Sales accounts for that type. The cost code itself is the fine-grained internal unit; the cost type + Xero account is the coarse Xero-facing bucket it rolls up into.

### 2.C Reconciliation — account-level, by cost type

Following directly from 2.A/2.B: for every cost-type account in use, Wayleave's summed job-costing total (across all jobs, for that cost type) must equal the Xero GL balance for that account. This is coarser than job-level reconciliation — by design, since Xero has no job-level data to reconcile against. Errors surface per-account: which cost-type accounts reconcile and which don't, catching non-standard or client-modified charts of accounts.

### 2.D Xero contact matching

- **Sales invoices**: matched to the existing Xero Customer.
- **Suppliers/subcontractors**: matched to an existing Xero contact where one exists. If no matching supplier exists in Xero, flag it and push the supplier name into Xero to create the contact, so a bill/cost can be raised against it and matched to the bank feed — Hubdoc-like behaviour.

### 2.E VAT / CIS on synced bills

- **VAT**: tax rate taxonomy mirrors Xero's own; user selects a default tax rate per customer/supplier (overridable per invoice), Hubdoc-style.
- **CIS**: **Wayleave does not calculate CIS.** Bills are coded and pushed to Xero at gross; Xero's own CIS engine (verification, deduction, returns) handles CIS entirely — consistent with treating Xero as the CIS source of truth (section on capture pipeline / CIS). No CIS-specific logic needed in Wayleave for v1 beyond passing the transaction through.

### 2.F Sync cadence

15-minute batch is acceptable for v1; instant/near-real-time is the long-term ideal, not a v1 requirement. No job queue infrastructure (Redis/BullMQ) needed yet — a scheduled function is sufficient at pilot scale.

### 2.G OCR / email intake (provisional, pending pilot data)

- **OCR**: Azure Document Intelligence (prebuilt invoice model), provisionally — believed to have better line-item extraction accuracy than AWS Textract AnalyzeExpense for this document type, though pricing is equivalent. Choice between the two APIs **still not confirmed** — needs 20–30 real pilot-client invoices run through both before fully committing. Does not require Azure hosting; called as a standalone API regardless of hosting target. **Live-verified** against a real Azure resource (own tenant, `admin@wayleavejc.co.uk`, isolated from PPA's Azure environment) and two real invoice PDFs — vendor, date, total, and line items all extracted correctly on the first real test, no parsing fixes needed.
- **Email intake**: AWS SES is still the intended production route (ties to the AWS hosting decision, 2.J) — receiving rule → S3 → Lambda → OCR provider, revisit with Azure Communication Services or Mailgun if hosting ever moves to Azure. **Dev/pilot stand-in built and live-verified in the meantime**: IMAP polling of `invoices@wayleavejc.co.uk` (Ionos Mail Basic) feeds the exact same `ingestDocument` pipeline as manual upload — see §17. Not the long-term architecture (polling vs. push, single shared mailbox not per-tenant), but proves the capture pipeline end-to-end against real inbound mail without waiting on an AWS account.
- **PO matching**: exact match only for v1 (post-normalisation — strip whitespace/dashes/leading zeros, case-insensitive). No fuzzy auto-linking for PO identity, ever — a confident-but-wrong fuzzy match would misallocate cost while keeping totals balanced, which reconciliation can't catch. Fuzzy matching, when added later, produces a suggestion for human confirmation, never an auto-link.
- **Failed/ambiguous extraction**: always shown in the review UI alongside the source document (never a data table without the document visible). Three states — low-confidence (flagged fields), extraction-succeeded-but-possibly-wrong (document shown for visual check), extraction-failed (blank form, document attached, full manual entry) — all three enter the same review queue, nothing silently drops. Every human correction is logged against the original OCR output (feeds the AI cost-code-suggestion groundwork already noted as phase 2).

### 2.H Shared split-allocation component — data shape

A generic `allocation_lines` table, reused across subcontractor invoices, direct payments, and material/stock allocation:

- `source_line_reference` — the specific invoice/document *line*, not the parent transaction, so a multi-line document can split different lines to different jobs independently. (Confirm against real pilot invoices whether multi-line splitting actually comes up.)
- `cost_object_id` — the job/hierarchy node the cost allocates to, at any level.
- `allocation_type` — `percentage | fixed_amount | time_based`. Time-based: client enters hours per job, system derives the percentage split.
- `value` — the entered percentage, amount, or hours, per `allocation_type`.
- `expected_total_hours` — required only for time-based, captured from the source document. Entered hours validate against this expected total (not their own running sum), so a half-finished allocation can't silently pass as complete.

**Validation**: allocations on a given source line must sum to exactly 100% / the full fixed amount / the full expected hours before that line counts as allocated — enforced at the application level at minimum, ideally also a DB constraint. No partial splits ever count as done.

**Defaults**: client sets a default allocation method **per context** (subcontractor / direct payment / stock), not one tenant-wide default — still overridable per instance. Changing a default only affects new allocations going forward, never retroactively restates existing ones.

Milestone billing (2.K) reuses this same `allocation_type` convention (percentage | fixed_amount) rather than inventing a second way to express the same idea.

### 2.I Labour / employee rates

- `employees` (tenant-scoped) + `employee_rates` with an effective-from date **and** a `rate_type` (`actual | standard`) — both must coexist per section 8, since actual payroll totals must still be captured even for standard-costing clients, to compute the variance.
- Backdated rate changes never silently restate already-posted months — require an explicit correction instead.
- **Open**: how rates themselves get entered/updated (manual admin entry vs. a second import) — separate mechanism from the hours import below. Not yet resolved.
- **Import template columns** (provisional, pending the pilot's actual payroll extract format): `employee_identifier`, `cost_object_id`, `date`, `hours` (or `days`), `day_type`. Whether `day_type` carries a pay multiplier (overtime, bank holiday) is undecided and depends on whatever the pilot's real extract turns out to need.

### 2.J Variance account mapping

Wayleave creates default Cost of Sales accounts per cost type (Materials, Labour, Subcontractor, Labour Rate Variance) during setup — checking first whether a suitable account already exists in the client's COA and offering to map to it, only creating new when nothing suitable is found. All Wayleave-managed accounts are flagged as such (e.g. "Labour COS — Wayleave managed"); any unexpected movement in one that didn't originate from Wayleave is itself a reconciliation flag. Reconciliation drills down by supplier (Materials) and by person (Labour), not only by job. Same pattern extends to Subcontractor COS and future Plant COS.

### 2.K Milestone schema

Milestones table scoped to the lowest-level job: sequence/order, name, `allocation_type` (percentage | fixed_amount) + value (reusing 2.H's convention), status `pending → complete → billed`. Payment status is **not** duplicated in this table — link to the Xero invoice created on billing and query Xero for payment state, rather than tracking a parallel copy that can drift. Sum of all milestones for a job must equal exactly 100% / the full contract value. **Strict sequential completion is enforced by default for v1** (can't invoice a later milestone before an earlier one) — can be relaxed later if a contract genuinely needs it, via an explicit per-job flag.

### 2.L GP margin alert threshold

Client-configurable, not hardcoded — no universal correct number. Alert when (budgeted margin %) minus (current margin %, from committed + actual cost against budgeted/contract value) exceeds a client-set tolerance. Suggested starting default: **5 percentage points** (a starting point for discussion, not a researched figure). Must use committed + actual (not actual alone) to function as an early warning rather than a post-invoice discovery.

### 2.M Authentication and roles

Auth.js (NextAuth). **Superseded**: email magic-link was the original MVP choice; explicitly reversed after launch — magic-link was judged a higher security/GDPR risk, replaced with password + mandatory TOTP 2FA. See §19 for the current implementation. Authorization supports four access patterns:

- **Tenant-wide Editor** — sees/acts on everything in the tenant.
- **Tenant-wide Viewer** — read-only, everything.
- **Project-scoped Manager** (Mid/Premium) — hierarchy-branch-scoped, per Addendum 1.B.
- **Cross-tenant Accountant** — one login can belong to multiple client tenants (many-to-many user↔tenant, role scoped per membership, license allocated per client tenant not per accountant — mirrors Xero's own adviser-access pattern). **Decided**: narrower than full Editor — broad read access plus reconciliation/journal rights, but cannot restructure a client's job hierarchy. Mirrors how an external accountant typically operates inside a client's own Xero.

### 2.N Hosting and infrastructure

- **AWS, eu-west-2 (London)** — fresh billing/infra account under Wayleave specifically, separate from any Purple Penguin Accountancy accounts.
- **Object storage**: S3, tiered per the brief (Standard <18 months, Glacier Deep Archive beyond). If OCR ends up on Azure (2.G), documents cross the cloud boundary per OCR call (S3 → Azure → back) — negligible cost at pilot volume, but a known behaviour, not an oversight.
- **Secrets**: `.env` is correct for the single dev-level Xero connection today. Once a second tenant connects their own Xero org, move to AWS Secrets Manager or KMS-based per-tenant encryption — not a home-rolled encrypted column. Note this is a **token-refresh lifecycle**, not static secret storage: Xero's access token is short-lived and each refresh invalidates the prior refresh token, so the design needs a correct refresh-and-store cycle per tenant, not one-time encrypted storage.

### 2.O Testing strategy

Focused unit/integration tests on the money-math logic; no full end-to-end UI coverage required for v1. Cover specifically: allocation splitting (all three `allocation_type`s), reconciliation comparison, labour standard-costing variance, hierarchy roll-up at any depth, milestone billing sums. Needs an explicit, tested rounding rule (remainder allocation) — a naive percentage split will not sum back to the source total. Property-based testing (e.g. fast-check) for the allocation/reconciliation invariants specifically, not just example-based cases. Separate, less-frequent Xero sandbox integration tests for sync/attachment/auto-account-creation — mocked responses can't catch Xero's real API behaving differently than assumed.

---

## 17. Build status — gap remediation pass (post Stage-4 review)

A full codebase-vs-brief review after Stage 4 (labour) surfaced several shortcuts taken during earlier build passes. All have since been fixed and live-verified against the Xero Demo Company and local Postgres (see `src/db/seed.ts` for the live proofs — RLS isolation, PO matching, capture pipeline, storage round-trip, duplicate detection, split-allocation rounding, labour posting, idempotency guards, account-collision guard, and the real Xero bill attachment; all pass on a fresh reseed):

- **Real document storage.** `src/lib/storage/` (adapter pattern, mirrors the OCR/accounting adapters) — `ingestDocument` now actually persists uploaded bytes (local filesystem for now, `.data/` gitignored; swap for `S3Adapter` per 2.N once AWS is provisioned) instead of discarding them. `pushToXero` attaches the real retrieved bytes to the Xero bill — no more fabricated placeholder text. Live-verified: pushed a real invoice, fetched it back from Xero, byte-identical content.
- **Invoice duplicate detection** (explicit requirement, not in the original brief). `ingestDocument` checks every new document against all previously captured ones — processed and still-pending alike — on two signals: same vendor+amount+date, or same PO+amount. A match sets `documents.possibleDuplicateOfDocumentId`, withholds automatic transaction creation regardless of PO match, and routes it into the existing manual-allocation review flow with a visible warning naming the earlier document. Confirming and allocating it manually is the "yes, process anyway" action — no separate UI built for that.
- **Labour period idempotency.** `postLabourPeriod` refuses to run twice for the same `periodStart_periodEnd` — checks for existing `labour_allocation` transactions with that `sourceReference` before creating anything.
- **Duplicate time-entry detection.** `importTimeEntries` checks each row against existing entries for the same employee+job+date before inserting, reporting a duplicate as an error rather than silently doubling hours. Backed by a DB unique constraint (`labour_time_entries_employee_job_date_unique`) as defense in depth.
- **Extraction-status consistency.** A document that matched a PO but has no extracted vendor name is no longer marked `failed` — the PO already carries vendor identity, so it's `needs_review` instead. `failed` is now reserved for extractions with no usable amount at all.
- **Partial-period display fix.** `getApprovedLabourPeriods` only lists a period as "ready to sync" once every transaction in it is approved — previously it summed just the approved subset, which could show (and let a user push) an incomplete total.
- **Account-collision guard.** `upsertLabourSettings` rejects a payroll clearing account code that matches the job-costed Direct Labour or Labour Rate Variance account — those must stay genuinely distinct for the reclassification journal to mean anything.
- **Manual journal sign-convention self-check.** `pushLabourPeriodToXero` snapshots account balances before and after posting and compares the actual delta against the expected job-costed total, logging a loud warning (never a thrown error — the journal has already posted by that point) if they don't match. Diagnostic only, since live testing is still blocked on the Xero custom connection's `accounting.manualjournals` write scope (read-only as of this pass) — genuinely untested until that scope is granted.

## 18. Email intake + real OCR — live-verified (dev/pilot stand-in)

Built and proven end-to-end against real inbound mail, ahead of the AWS SES route (2.G/2.N still pending an AWS account):

- **Mailbox**: `invoices@wayleavejc.co.uk` (Ionos Mail Basic). `src/lib/mail/imap-client.ts` polls it via IMAP (`imapflow` + `mailparser`), pulls non-inline attachments, and feeds each one through the exact same `ingestDocument` used by manual upload — see `checkInboxForNewInvoices` in `capture-pipeline.ts` and the "Check inbox now" trigger on the capture page. Single shared mailbox, single-tenant only for now; per-tenant routing (a dedicated address per client) is a real decision for once more than one tenant is actually forwarding invoices in.
- **Real bug found and fixed via live testing, not something a mock would ever catch**: issuing an IMAP STORE command (marking a message `\Seen`) from inside the same connection's still-open FETCH stream deadlocks — the server won't respond to the new command until the client finishes reading the FETCH already in progress. Fixed by collecting UIDs during the fetch loop and batching the flag update into one call after the stream drains.
- **Azure Document Intelligence**: connected to a dedicated Azure resource under its own tenant (`admin@wayleavejc.co.uk`, Free F0 tier) — deliberately isolated from Purple Penguin Accountancy's Azure environment/billing, since Wayleave is a separate business. Live-tested against two real invoice PDFs sent to the mailbox: vendor name, date, total, and line items all extracted correctly on the very first attempt, no response-parsing fixes needed (the adapter had been written from Azure's documented API shape but never tested live — see 2.G).
- Both test invoices had no PO number (real-world non-construction invoices used for the test) and correctly landed in "Unmatched documents" for manual allocation rather than being force-matched — exactly the intended behaviour, not a gap.

## 19. Authentication — Auth.js v5, password + mandatory TOTP 2FA, live-verified

**Supersedes the original 2.M decision.** Email magic-link shipped first, then was explicitly reversed on security/GDPR grounds — losing control of an email account would otherwise be a single point of failure for account takeover. Live-tested end-to-end, including the negative paths: correct password + correct TOTP → signed in; wrong password → generic "invalid" (no user-enumeration signal); correct password + wrong TOTP → rejected, attempt counted; correct password + backup code → signed in, code deleted (confirmed single-use by checking the DB directly); 5 failed attempts → account locked, **even a subsequently-correct password is rejected** while locked.

- **Security fields live on the domain `users` table directly** (`passwordHash`, `totpSecretEncrypted`, `totpEnabled`, `failedLoginAttempts`, `lockedUntil`, `tokenVersion`) — no separate auth-adapter table. Auth.js's Credentials provider requires the **JWT** session strategy (database sessions aren't supported for it), which needs no adapter at all, so the earlier `user`/`account`/`session`/`verificationToken` tables were dropped (migration `0010_robust_purifiers.sql`) rather than left unused.
- **Password**: Node's built-in `scrypt` (no third-party hashing dependency), timing-safe comparison, 12-character minimum (NIST SP 800-63B favours length over forced complexity rules).
- **TOTP 2FA is mandatory, not optional** — account setup cannot complete without it. Secret encrypted at rest with AES-256-GCM (`AUTH_TOTP_ENCRYPTION_KEY`, distinct from `AUTH_SECRET`) — a TOTP secret is as sensitive as a password and must never sit in the DB in plain text. `otpauth` + `qrcode` for enrollment; a secret isn't considered "enabled" until a real code against it is confirmed (a scanned-but-unconfirmed QR doesn't count).
- **Backup codes**: 10 one-time codes generated at enrollment, shown exactly once, hashed (not scrypt — already-high-entropy random codes don't need a deliberately slow KDF, a keyed HMAC is the right tool), and *deleted* (not flagged) on use so a stolen DB snapshot can't replay a spent code.
- **Brute-force lockout**: 5 failed attempts (password *or* TOTP *or* backup code — an attacker can't dodge the counter by mixing attack vectors) locks the account for 15 minutes.
- **Instant revocation despite JWT sessions**: `users.tokenVersion`, checked against the DB on every request in `auth.ts`'s `jwt` callback. Bump it and every outstanding JWT for that user stops working immediately — the incident-response lever a bare JWT strategy doesn't otherwise give you, since there's no server-side session row to delete. `revokeAllSessions` in `db/queries/auth.ts` is wired to the "Sign out everywhere" button on the team page (§20) — live-verified by revoking my own live test session mid-session and confirming the next request required a fresh sign-in.
- **Two-step sign-in, no client-side JS**: `/signin` (password) → on success, a short-lived HMAC-signed "bridge" token (not the password) carries the request to `/signin/totp` for the second factor — two real page loads, matching how the rest of this app is built. `authorize()` is still the sole authority: it independently re-verifies the bridge token's signature and expiry rather than trusting that the caller already checked it.
- **A real bug found via live testing**: passing `totpCode: undefined` into `signIn("credentials", {...})` when submitting a backup code instead didn't get dropped as expected — it survived as the literal string `"undefined"`, which is truthy, so `authorize()` always took the TOTP branch even for backup-code attempts. Fixed by only including the relevant key in the credentials object, never an explicit `undefined`.
- **Account setup / recovery**: since sign-in itself no longer touches email, email's only remaining job is the one-time setup/reset link (`password_setup_tokens` — hashed, single-use, 24h expiry). `sendSetupEmail` reuses the same real-SMTP-attempt-then-console-fallback pattern already proven out for the old magic-link sender, since outbound SMTP (port 587) is **confirmed blocked at the network level in this dev environment** (a direct OS-level TCP test times out completely — not an app or credentials issue). **Before any real pilot use**: either unblock port 587 wherever this actually runs, or switch to an HTTP-based transactional email API (Resend recommended — port 443, same pattern already proven reliable for Xero/Azure/IMAP in this app).
- **Route protection**: no `middleware.ts` — Next.js middleware runs on the Edge runtime by default, which can't load Node-only modules the Postgres client needs (e.g. `stream`). The real gate is `src/app/t/[tenantId]/layout.tsx`, a normal Node.js server component: confirms a session exists, then checks `tenant_memberships` for that specific user+tenant (not just "is anyone signed in") — a member sees the dashboard, a non-member gets a clear "doesn't have access" page, and it's still exactly one choke point since every nested route sits under this layout. Homepage lists only the tenants the signed-in user actually belongs to.
- **A real RLS robustness gap, found via live testing and fixed everywhere, not just here**: `rls-helpers.ts`'s shared tenant-isolation policy (used by all 15 tenant-scoped tables) and `memberships.ts`'s policies both did `current_setting(..., true)::uuid` directly — a malformed (e.g. empty-string) session variable throws `invalid input syntax for type uuid` and 500s the whole query, instead of the policy just evaluating to "no match" the way a security check should degrade. Observed live: `app.current_user_id` was seen reading back as `''` instead of `NULL` on an already-used pooled connection at the start of a fresh transaction — not fully root-caused (bounded investigation via `pg_backend_pid()` confirmed it was the same physical connection each time, ruling out true concurrent cross-talk between different connections), but fixed at both ends regardless: `withTenant` now sets a real SQL `NULL` instead of `userId ?? ""` when there's no user, and every policy wraps the cast in `NULLIF(current_setting(...), '')` so a malformed value can never produce a hard error, only a clean deny. Migration `0008_material_rogue.sql`. Worth a closer root-cause pass before real concurrent multi-user production traffic, even though the defensive fix already closes the crash (and the cross-tenant-leak risk a naive fix might have missed).
- **Seeded test accounts**: `Alex@purplepenguinaccountancy.co.uk` (real account, for actual personal use — has a live setup link, not yet completed since finishing TOTP enrollment needs Alex's own phone) and `invoices@wayleavejc.co.uk` (the already-wired-up IMAP mailbox — fully completed setup and used to prove every path above live: correct/wrong password, correct/wrong TOTP, backup code, lockout, revocation).

## 20. Tenant team management — admin control over tenant membership, live-verified

Requested directly as a follow-on to §19: password+2FA is only as good as who's allowed to hold an account on a given tenant, so editors need real self-service control over their own roster rather than that living only in a DB console. `/t/[tenantId]/team`, editor-only (viewers see the same roster read-only, per the existing 2.M role model).

- **Roster view**: every member's email, name, role (editor/viewer), 2FA status (enabled / not enrolled / setup pending), and locked/active — `listTenantMembers` in `db/queries/auth.ts`, tenant-scoped through the same `withTenant` RLS path as everything else. "Locked right now" is resolved as a SQL boolean (`locked_until > now()`) in the query itself, not compared against `Date.now()` in the component — a React server component's render body must stay a pure function of its data (ESLint's `react-hooks/purity` rule catches this), so time-sensitive checks belong in the data layer.
- **Invite**: adds an existing global user to the tenant, or creates one if the email is new. Users are global (§2.M), so someone who already has an account elsewhere just gains access to the new tenant immediately with no new credential; a genuinely new user gets a `password_setup_tokens` link sent via the same real-SMTP-then-console-fallback path as account setup (§19) since port 587 is still blocked in this dev environment.
- **Role change / remove**, both editor-only, both guarded by the same invariant: **a tenant can never be left with zero editors.** `updateMemberRole` and `removeMember` count remaining editors before acting and throw a friendly error (shown inline via a `?error=` query param, not a crash) if the action would drop the count to zero. Live-verified by attempting to demote and then remove the sole remaining editor — both correctly rejected.
- **Sign out everywhere** — an editor can force-revoke any member's sessions on demand (bumps `tokenVersion`, §19), including their own. Live-verified end-to-end: revoked my own live session mid-test, was immediately signed out, and had to complete a fresh password+TOTP sign-in to get back in.
- **A real Next.js server-action pitfall, found via live testing**: the four admin actions (invite/role-change/remove/revoke) originally shared a `try/catch` error-reporting helper defined as a closure *inside* the page component, with each action passing another local closure to it as an argument. That broke Next.js's server-action serialization (`"Functions cannot be passed directly to Client Components unless marked with 'use server'"`) — every admin action crashed the whole page instead of showing the intended friendly error. Fixed by moving all four actions into their own top-level `"use server"` module (`team/actions.ts`), each taking `tenantId` as an explicit first parameter and bound at render time via `.bind(null, tenantId)` — the supported pattern for parameterized server actions; passing a closure as another function's argument across the server-action boundary doesn't work, only plain serializable arguments do.

## 21. Milestone billing / WIP — sections 9 and 10, live-verified

Next item in the build order (§15) after auth/team management. Built as one shared cost/billing feed per the brief's explicit instruction ("this is the same underlying cost/billing feed as margin protection — build it once, don't calculate it twice") rather than two separate calculations.

- **`milestones` table** (`src/db/schema/milestones.ts`) mirrors Addendum 2.H's `allocation_lines` convention deliberately: `expectedTotalAmount` (the job's contract value) is repeated on every row for a job rather than split into a separate header table — a half-created schedule never silently reads as complete just because what's entered so far is internally consistent, same reasoning as 2.H. `allocationType` (percentage | fixed_amount), `status` (pending → complete → billed), `xeroInvoiceId` — payment status is deliberately not tracked here, per §2.K; query Xero via `xeroInvoiceId` instead of keeping a copy that can drift.
- **`jobs.clientName`** (new column) — who to bill for a job's milestones. Not present in the original core data model (§3); added because milestone billing genuinely cannot function without knowing the client, and resolves from the nearest *ancestor* with one set if the leaf job has none of its own (`resolveClientName` in `db/queries/milestones.ts`) — the same "any node, walk up if unset" spirit as the rest of the job tree. Live-verified: SUBSITE-A has no `clientName` of its own and correctly resolved "Northern Powergrid" from its PO-1042 ancestor.
- **`billing_settings`** (one row per tenant, same shape as `labour_settings`): `salesAccountCode` (plain Xero account code, same pattern as labour's `payrollClearingAccountCode` — a revenue account isn't a Wayleave "cost type" so it doesn't belong in `cost_type_accounts`), `autoCreateDraftInvoiceOnComplete` (default on), `gpMarginAlertThresholdPct` (§2.L, default 5).
- **Xero adapter gained `createSalesInvoice`** (ACCREC/DRAFT) and `listRevenueAccounts` (Type REVENUE or SALES) — `createBill` only ever created ACCPAY/AUTHORISED purchase bills, which cannot represent a client-facing invoice. Always DRAFT, never sent — the client reviews and sends it themselves, matching §9's explicit "auto-create a draft bill... not auto-sent."
- **Strict sequential billing (§2.K)**: `getSequentialBillingBlocker` — a milestone can be marked *complete* out of order (the spec's wording is specifically about invoicing, not completion), but creating its Xero invoice is blocked until every earlier-sequence milestone for that job is already `billed`. Auto-bill-on-complete treats "not yet its turn" as a silent, expected no-op (stays at `complete`); the manual "Create draft invoice" button treats the same condition as a real error with a friendly message naming the blocking milestone. Live-verified: completed a schedule's milestone #2 before #1, confirmed it did *not* auto-bill, then confirmed the manual button showed `Can't invoice this milestone before "Stage A" (#1) has been billed.`
- **Rounding**: reuses `allocateAmounts` (§2.O's largest-remainder rule, already proven for split-allocation) so a percentage-based schedule's resolved £ amounts always sum exactly to the contract value — never "close enough."
- **WIP/margin rollup** (`src/db/queries/wip.ts`) — every figure is a *subtree* total (a job plus all its descendants), not just the job's own row, since "cost incurred to date... at the relevant hierarchy level" only means something if a parent node reflects everything underneath it. Rolled up in plain JS from an id-based ancestor chain built off `parentId` links — **not** `getFullJobTree`'s own `path` field, which is an array of job *codes* (see `job-tree.ts`), not ids; using it directly as a set of ancestor ids would have silently produced wrong rollup totals. Caught and fixed before it ever ran, not a live bug.
- **WIP position** shown as a signed £ delta (billed − cost-to-date), not a boolean flag: positive = over-billed (cash-flow risk, billed ahead of progress), negative = under-billed (margin-at-risk, cost ahead of billing) — standard construction-accounting framing, more informative than a plain badge. **GP margin alert**: budgeted margin % (from budget vs. contract value) minus current margin % (from committed+actual vs. contract value) compared against the tenant's configured threshold. Both live-verified against the seeded PO-1042/SUBSITE-A tree and the standalone OVERHEAD job, numbers checked by hand against the query output.
- New page pair: `/t/[tenantId]/billing` (WIP table + settings form) and `/t/[tenantId]/billing/[jobId]` (per-leaf-job schedule creation and milestone actions) — same server-action-module pattern as `team/actions.ts` (plain top-level `"use server"` exports, bound via `.bind(null, tenantId, jobId)` at render time, not closures).
- **A real settings-save bug caught during live testing**: the first "Save settings" click produced no server-action invocation at all (confirmed via server logs — no POST, no `saveBillingSettingsAction` line), even though the page's rendered `<select>` still showed the newly-picked option, because that was just the locally-set DOM value from the test tooling, not a server-confirmed re-render. A second attempt on a freshly-loaded page worked and was confirmed via both the server log and a direct DB read. Documented here as a reminder that a UI screenshot/DOM read after a click is not proof an action ran — check the server log or the database.
- **Known minor UX quirk, not fixed**: the `?error=` query-param banner pattern (shared with `team/actions.ts`) persists across an unrelated *successful* subsequent action on the same page, since success only calls `revalidatePath` and never clears the query string. Cosmetic only (a stale error banner next to genuinely fresh, correct data) — worth a real fix if it's ever confusing in practice, but not blocking.
- Seed data: `PO-1042` in `seed.ts` now carries `clientName: "Northern Powergrid"`, set deliberately at the PO level (not on `SUBSITE-A` itself) to prove ancestor resolution. The live-test milestone schedules themselves (SUBSITE-A's real 30/40/30, OVERHEAD's test 50/50) were created through the actual UI against the running dev DB, not seeded directly — consistent with how every other feature in this build has been proven. Their budget/contract-value figures don't reconcile with each other (SUBSITE-A's schedule uses a contract value invented for this test, unrelated to PO-1042's pre-existing £50,000 labour budget) — a live-test artifact, not a realistic P&L.

---

*This brief reflects decisions made through a series of scoping conversations — treat it as the starting context, not a substitute for asking clarifying questions where something here is ambiguous or where a real implementation choice hasn't been made yet.*
