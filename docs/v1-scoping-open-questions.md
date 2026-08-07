# V1 Scoping — Open Questions

**Purpose:** everything below is a real decision or missing detail that will
change how the remaining v1 build works, surfaced now rather than discovered
mid-build. Fill in the **Your answer** line under each item (directly in this
file, or tell me in chat and I'll fill it in). Items with **My recommendation**
are things I'd default to if you don't have a strong preference — say "go with
your recommendation" and I'll proceed on that basis rather than blocking.

Organised by build-order stage (CLAUDE.md section 15). Stage 1 is done;
everything from Stage 2 onward has open items.

---

## 0. Foundational — blocks almost everything else

### 0.1 Cost code ↔ Xero account mapping
**Why it matters:** the reconciliation gate (section 5/12) is "Xero GL balance
equals job costing total for that scope" — but there's currently no link
between a `cost_code` row and a Xero chart-of-accounts code. Without this,
nothing can be reconciled, and bills can't be coded correctly when pushed.

**Question:** does each cost code map to exactly one Xero account code
(simplest, and what I'd build against by default), or can several cost codes
share one Xero account (coarser Xero-side COA, finer job-costing-side detail)?

**My recommendation:** one Xero account code per cost code for v1 — simplest
mapping, cleanest reconciliation, matches "client-configurable cost codes
reflecting their own chart of accounts" (section 3). Many-to-one can be added
later without breaking anything if it turns out to be needed.

**Your answer:**

### 0.2 Job hierarchy → tracking category flattening depth
**Why it matters:** Xero's tracking category caps at ~100 options. The brief
says "one job code or a concatenated path" gets pushed — but doesn't say
*which* job in the hierarchy that is. If every sub-site/PO/line-item gets its
own tracking option, a client with deep structure blows through 100 fast. If
only the top-level job gets one, reconciliation can only be checked at
top-level granularity in Xero (sub-level detail stays purely in this
product's DB, which the brief does say is the permanent source of truth
anyway).

**My recommendation:** tag every Xero transaction with the **top-level
ancestor job's code only** (e.g. "REGION-NORTH", not "REGION-NORTH >
PO-1042 > SUBSITE-A"). At 10–30 concurrent jobs this stays well inside the
100-option ceiling regardless of how deep any individual client nests. Full
hierarchy-level detail (PO, sub-site) stays exclusively in this product's DB
— which is already the source of truth per section 4, so nothing is lost,
Xero just never needs to know about it.

**Your answer:**

### 0.3 Xero contact = which entity?
**Why it matters:** milestone billing (section 9) auto-creates draft bills in
Xero, which need a Xero **Contact** (the customer). Subcontractor bills need
a Contact too (the subbie). Neither exists in the schema yet.

**Question:** do we store a `xero_contact_id` on a job (customer) and on a
new `subcontractors` entity, synced/matched by the user, or looked up live
from Xero every time by name?

**My recommendation:** store a cached `xeroContactId` + `xeroContactName`
alongside the relevant entity, refreshed via a "match to Xero contact" action
in the UI (search Xero contacts, pick one, cache the ID). Avoids a live Xero
call on every bill push and avoids ambiguous name-matching.

**Your answer:**

---

## 1. Xero integration remainder (Stage 2, in progress)

### 1.1 VAT / DRC treatment on synced bills
**Why it matters:** construction industry has domestic reverse charge (DRC)
VAT rules — the wrong tax type on a pushed bill is a real compliance issue,
not just a cosmetic one.

**Question:** is VAT/tax type (a) set per cost code as a default, (b)
chosen manually per invoice during the approval step (section 5A), or (c)
derived from vendor/contact settings already in Xero?

**Your answer:**

### 1.2 Sync cadence infrastructure
**Why it matters:** brief accepts 15-min-to-hourly batch for v1, but nothing
runs sync/reconciliation on a schedule yet — there's no job queue. Brief
suggests BullMQ/Redis.

**Question:** confirm BullMQ + Redis, or would you rather a simpler
approach for v1 (e.g. a cron-triggered serverless function, no persistent
queue) given the pilot's modest volume (10–30 jobs)?

**My recommendation:** skip Redis/BullMQ for v1 — a scheduled function
(e.g. every 15 min) calling a sync routine is simpler to run and debug at
this scale, and Redis is easy to add later if volume genuinely needs a real
queue.

**Your answer:**

### 1.3 CIS: build our own, or lean on Xero's built-in CIS?
**Why it matters:** Xero already has native CIS support (UK orgs) —
verification status, deduction calculation, CIS returns. Building our own
CIS logic in parallel risks the exact "two systems disagreeing" problem this
whole product exists to prevent.

**Question:** does this product read/display Xero's own CIS data (deduction
rate, verification status) rather than calculating CIS independently?

**My recommendation:** yes — treat Xero as the CIS source of truth (it's
already HMRC-connected for CIS returns) and have this product read CIS
status/deduction from Xero rather than recalculating it. Reduces scope
significantly and removes a whole category of "two systems disagree" risk.

**Your answer:**

---

## 2. Document capture pipeline (Stage 3)

### 2.1 OCR provider
**Question:** AWS Textract `AnalyzeExpense` or Azure Document Intelligence's
prebuilt invoice model? Brief says either is fine cost-wise (~$0.01/page) —
this is really about which cloud ecosystem you'd rather have an account
with, given hosting is also AWS-or-Azure (brief section 14).

**Your answer:**

### 2.2 Email inbound routing
**Question:** Mailgun or SES for the per-client/per-job forwarding address?
Same "which ecosystem" consideration as 2.1 — SES pairs naturally if hosting
lands on AWS.

**Your answer:**

### 2.3 PO number matching strictness
**Question:** exact match only against our PO records, or fuzzy match with a
confidence score (feeding into the confidence-based routing that Mid tier
uses per Addendum 1.A)? Exact-match-only is simpler and safer to build first.

**Your answer:**

### 2.4 What happens when OCR extraction fails or is ambiguous
**Why it matters:** the brief requires nothing to post unchecked, but
doesn't say what the *reviewer's* experience is when the OCR got the
vendor/amount wrong, not just when it's low-confidence.

**Question:** does a failed/ambiguous extraction land in the same
approval queue as a successful one (with fields left blank for manual
entry), or a separate "needs manual entry" queue?

**Your answer:**

---

## 3. Subcontractor / CIS split-allocation (Stage 3, shares work with 2)

### 3.1 Shared split-allocation component — data shape
**Why it matters:** brief section 7 asks for one reusable component across
subcontractor invoices, direct payments, and material/stock allocation. This
needs designing once, not per-use-case.

**Question:** confirm a generic `allocation_lines` table (parent
transaction reference, job_id, percentage_or_amount, source reference) is
the right shape — or is there a specific split UX (e.g. always % vs always
£) subcontractors on this pilot actually use that should shape it?

**Your answer:**

---

## 4. Labour / payroll allocation (Stage 4)

### 4.1 Employee entity — doesn't exist yet
**Why it matters:** section 8 requires storing each employee's fully-loaded
rate (base + employer NI + pension + on-costs), for both actual and standard
costing. No `employees` table exists yet.

**Question:** confirm employees are tenant-scoped (like everything else) and
that rate history needs to be **versioned** (rates change over time, and
"actual costing recalculated monthly" implies we need the rate that applied
in a given month, not just a current rate)?

**My recommendation:** yes to both — `employees` table + a separate
`employee_rates` table with an effective-from date, so historical months
stay correctly costed even after a rate change.

**Your answer:**

### 4.2 Fixed import template — exact column layout
**Why it matters:** brief says "standard, fixed import template," which
means the columns need to be nailed down before building the importer.

**Question:** what columns, in what order, does the pilot client's actual
time data come in as (or what should the template dictate)? At minimum I'd
expect: employee identifier, job code, date (or week + day), hours/days,
day-type (full/half day) if used.

**Your answer (or: "design a sensible default, I'll adjust once I see the
pilot's real payroll extract"):**

### 4.3 Variance account mapping
**Question:** under standard costing, the variance (`job-allocated + variance
= actual payroll total`) needs to post somewhere in Xero — which account?

**Your answer:**

---

## 5. Milestone billing / WIP (Stage 5)

### 5.1 Milestone schema — doesn't exist yet
**Question:** confirm a `milestones` table scoped to a specific (lowest-level)
job, with sequence/order, name, percentage-or-fixed-amount, and status
(pending/complete/billed)?

**Your answer:**

### 5.2 GP margin alert threshold
**Why it matters:** section 10 wants alerting "when a job's position
threatens the expected GP margin" — needs a concrete number to compare
against.

**Question:** is the "expected GP margin" per job pulled from the budget
(budgeted revenue vs budgeted cost), set as an explicit target field on the
job, or a tenant-wide default threshold (e.g. "alert if any job drops below
15% GP")?

**Your answer:**

---

## 6. Cross-cutting / non-functional (needed before this is usable by anyone but us)

### 6.1 Authentication — nothing exists yet
**Why it matters:** the dashboard currently has zero login. Anyone with the
URL can see all tenants' data. This is fine for a local dev preview, not
fine for anything real.

**Question:** which auth approach — a managed provider (Clerk, Auth0,
NextAuth/Auth.js with email+password or magic link), or something else?
This also needs to decide how a logged-in user's `tenant_memberships` rows
get looked up to populate the RLS session variables (`app.current_tenant_id`
/ `app.current_user_id`) on every request.

**My recommendation:** Auth.js (NextAuth) with email magic-link — free, no
vendor lock-in, integrates cleanly with the existing Drizzle/Postgres setup.

**Your answer:**

### 6.2 Hosting target
**Why it matters:** brief specifies UK-region hosting (AWS eu-west-2 or
Azure UK South) but nothing's provisioned. Also ties to 2.1/2.2 (OCR/email
ecosystem choice).

**Question:** AWS or Azure? Also: does Purple Penguin Accountancy already
have billing/infra accounts on one of these that this should sit under, or
is this a fresh account under Wayleave?

**Your answer:**

### 6.3 Object storage for documents
**Question:** S3 (if AWS) or Azure Blob Storage (if Azure) — follows from
6.2. Not urgent until the capture pipeline (Stage 3) is being built, flagging
now since it's a hosting-target dependency.

**Your answer:**

### 6.4 Testing strategy
**Why it matters:** no automated tests exist yet. Given how much of this
product's value is "the reconciliation math must never be wrong," some
level of automated testing on the reconciliation/allocation logic
specifically seems worth having before Stage 2/5 ship, even if broader UI
testing waits.

**Question:** comfortable with me adding focused unit/integration tests
around the money-math (allocation splitting, reconciliation comparison,
labour variance) as those pieces get built, without a demand for full
end-to-end UI test coverage in v1?

**Your answer:**

### 6.5 Secrets storage once there's more than one customer
**Why it matters:** right now Xero credentials live in `.env` — fine for one
dev-level connection. Once a second real tenant connects their own Xero org,
each tenant's client secret needs to live in the database, encrypted at
rest.

**Question:** flagging this now so it's not a surprise later — no decision
needed today, since it only matters once we're past the single pilot
connection. Revisit at that point.

**Your answer (optional, can skip for now):**

---

## How to use this doc

- Answer inline, or just tell me in chat which numbers you've decided on.
- Anything left blank when we reach that build stage, I'll ask about
  specifically at that point rather than guessing.
- Once an item's answered, it should get folded into CLAUDE.md as a decision
  (like the original brief + addendum were) — this doc is scratch space for
  getting to that point, not itself the permanent record.
