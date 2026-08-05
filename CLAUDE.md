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

- **Xero tracking categories are capped at 2 active categories, ~100 options each — and payroll transactions support only 1 category.** This means Xero can never hold the full job hierarchy. This product's own database is the permanent source of truth for the hierarchy; Xero only ever receives a flattened top-level reference (e.g. one job code or a concatenated path) tagged onto each transaction.
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
- **Branding**: standalone product, does not need to follow Purple Penguin Accountancy branding. Placeholder naming until a name is decided.

---

## 15. Suggested build order

1. Core data model — job tree, cost codes, transaction types *(in progress)*
2. Xero integration — auth, bill/attachment creation, tracking category push, reconciliation check
3. Capture pipeline — email intake, OCR, PO matching, allocation, approval (section 5A)
4. Labour — time-allocation import, rate calculation, payroll reconciliation view
5. Milestone billing and the WIP/dashboard views
6. Pilot with the real client, validate against section 13, iterate

---

*This brief reflects decisions made through a series of scoping conversations — treat it as the starting context, not a substitute for asking clarifying questions where something here is ambiguous or where a real implementation choice hasn't been made yet.*
