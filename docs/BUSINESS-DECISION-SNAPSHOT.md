# Business decision snapshot

The owner page at `/admin/marketing/rollup` and MCP tool
`get_business_decision_snapshot` share one read-only calculation. The older
`/admin/telegram/briefing` URL opens the same view. The old marketing detail
remains available on demand; weekly rollup refreshes continue without briefing
Telegram delivery. No new bot, scheduled digest, database table, or AI narrator
is introduced.

## Decisions before prose

The view offers at most three evidence-backed review cards, performance and
recorded-source comparisons, upcoming quoted work, and drill-through records.
Immediate unassigned work and service concerns precede historical invoice
reconciliation. Opposing visit-volume and invoice-value movements produce a
service-mix review prompt. Other queues are review candidates, not automatic
instructions to contact customers. All queues remain inspectable below the cards.

## Metric contract

- Reporting timezone: America/Denver. Last week is the last completed Monday
  through Sunday. Comparisons use four completed weeks and the preceding four.
  The current partial week is excluded.
- Monetary performance uses service date and one ready/pending/sent/paid
  per-visit invoice header total, including tax and valid zero totals. It is
  invoiced value, not period cash collection or accounting revenue recognition.
- Quotes never substitute for missing, draft, invalid or multiple invoices.
  Each cohort reports invoice-covered and total eligible visit counts. Unequal
  coverage disables the value comparison and makes coverage partial.
- Internal, estimate, warranty, restoration/project and consolidated-billing
  work is excluded from per-visit monetary performance. Relevant completed
  exclusions are counted. Consolidated detection includes customer billing mode,
  recurring template mode, batch entries, and the appointment batch-payer marker.
  This first version is deliberately not whole-company revenue.
- A missing customer classification fails monetary and upcoming totals closed.
  Query failures and the ordered 10,000-row reporting bound never become zeros.
- Marked-paid value reflects present invoice status, not payment date or bank
  reconciliation. Quote/invoice differences may be valid discounts or scope changes.
- Lead sources are recorded job labels. Missing, other and repeat customer remain
  distinct. Both periods expose invoice coverage. Counts do not establish causal
  marketing return or complete lead conversion.
- Upcoming work covers the next seven calendar dates, excludes parked/completed/
  cancelled work, and reports quotes. It does not calculate open capacity.
- Queues reuse existing bounded operational definitions and expose their windows,
  partial/unavailable status, and stable record IDs. Unread is not unanswered;
  unpaid is not overdue; missed-call records can already have been handled.

## Security and verification

The admin API requires admin/owner authorization before creating a privileged
client. MCP requires the existing `business:read` grant. Both use no-store/current
reads. The loader performs selects only. There are no mutations, external sends,
refresh jobs, or reservations. Evidence previews are bounded to three links per
source/decision and twenty current-period reconciliation examples.

Mocked tests cover singleton and array PostgREST relations, source failures,
pagination, Denver boundaries, zero invoices,
all exclusion classes, incomplete comparison cohorts, retained evidence IDs,
priority ordering, role/OAuth authorization and UI states. Keep production-backed
legacy integration suites excluded from unit checks. Live schema and read-only
record extracts can verify provenance without exercising operational actions.

## Intentionally not inferred

Cash position, company-wide profit, commercial/project profitability, advertising
ROI and remaining staffing capacity need their own reconciled sources. Do not
silently combine cash-basis accounting, service-date invoices, marketing sessions
and mismatched reporting weeks into a single score. Extend the shared contract
only when those definitions and coverage are verified.
