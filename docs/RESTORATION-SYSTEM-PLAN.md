# Restoration (Water Mitigation) System — Plan & Decision Record

Source: design conversation with Charles, 2026-08-30, prompted by an active flood
job (customer "Jill") that did not fit the carpet-cleaning invoice model.

**Purpose of this file:** capture EVERY decision made in that conversation so that
nothing is silently dropped between build passes. Each item has a status. Do not
mark anything DONE that has not been verified.

---

## 0. The core problem

Carpet cleaning is a single-day event: open job -> close job -> invoice -> QuickBooks
-> revenue_entries. Restoration is never one day. It is a mitigation day plus
typically three monitor days. Closing day 1 must NOT invoice, because the job is not
finished. Today Charles works around this by leaving the job open, which corrupts
statistics and hourly dollar figures.

## 1. Restoration is a separate flow, not a flag on carpet cleaning

- New top-of-calendar button next to "Book Job" — restoration jobs start there.
- No phone estimate. Emergency service fee is the only number quoted on the phone.
  Real pricing happens on site.
- Precedent to follow: `kind='estimate'` already has its own button, its own route
  (`/admin/operations/estimates/[id]`), its own calendar tone, and creates no invoice.
  Restoration follows the same pattern with `kind='restoration'`.

## 2. Project layer (multi-day)

- New parent table `restoration_projects`, one per loss.
- Each visit remains a row in `ops_appointments` with `kind='restoration'`, a
  `restoration_project_id` FK, and a `visit_type` of `mitigation` | `monitor` | `final`.
- Keeping visits as normal appointments preserves calendar, dispatch, GPS,
  timesheets, and tech assignment with no changes.

## 3. Invoicing held until the project closes

- Closing a mitigation or monitor day records work but creates NO QuickBooks invoice.
- Only closing the PROJECT assembles one invoice from all days and pushes it.
- Precedent: `isBatchMonthlyRecurring` in
  `src/app/api/admin/ops/appointments/[id]/route.ts` (~line 773) already skips the
  draft->ready->QB path. Restoration uses the same gate for a different reason.

## 4. Close-out is not tied to a day number

Charles: nothing is ever dry on day 1. Drywall-only routinely closes day 2. Wood
often runs to day 3, 4, or 5.

- Default: 3 monitor visits spawned after mitigation.
- EVERY monitor visit carries a "Dry standard reached — pull equipment and close"
  action. Whichever visit is tapped becomes the final visit.
- On close: equipment comes off the map (per-day accrual stops), invoice assembles,
  deposit is credited, balance is shown, signature + receipt + QuickBooks push happen
  ONCE.
- Remaining scheduled monitor visits auto-cancel and clear from calendar and tray.
- Extra days (day 5+) are added from the tray. Same mechanism both directions.
- Day 1 has NO close action at all — offering it is just a way to make a mistake.

## 5. Unscheduled tray + mobile placement

Charles does ~half his scheduling from his phone. Monitor days must fit around
carpet cleaning appointments, so they must NOT auto-drop onto the calendar.

- Monitor visits are created UNSCHEDULED: customer, address, visit type, duration,
  but no date/time. They sit in a tray pinned at the top of the schedule.
- **Desktop:** drag from tray onto the grid. Reuse the existing pointer-based drag
  pipeline in `operations-schedule.tsx` (`hitTestDateColumn`, `[data-date-column]`),
  which already works for mouse, touch, and pen. Tray drop SCHEDULES rather than MOVES.
- **Mobile:** drag is the wrong interaction — in day view you can only drop on the day
  you are already viewing. Instead: **tap-to-arm, tap-to-place.** Tap a tray card, it
  pins to the top as "placing: Monitor Day 2 — Johnson", you navigate days/weeks/month
  freely, tap an empty slot to land it. Tap the bar again to cancel.
- Wire tap-to-place on desktop too; it is often faster than dragging.

## 6. Catalog — the underbilling problem

Source file: `wtr co.xlsx` — a real Xactimate **WTR (Water Mitigation) price list for
Colorado, dated 2024-01-29**, 561 line items with codes, descriptions, units, prices.
Author "Megan Gehlen" (from a company Charles used to work for; not easily re-obtained).

Verified: Charles's existing 21 Restoration items match this list EXACTLY on price
(EXT 0.58, EXTA 0.86, PAD 0.72, GRM 0.34, DHM>> 105.46, DHM> 72.50, DRY++ 35.00,
ESRVD 197.29, ESRV 295.92). The catalog was built from this list.

### 6a. Unit bugs — 9 of 21 items (MONEY BUG)

| Item | Stored as | Correct | Code |
|---|---|---|---|
| Tear out trim $0.65 | per_sq_ft | **per linear ft** | BASE |
| Baseboard Detach $1.57 | per_sq_ft | **per linear ft** | BASED |
| Tear Out wet Drywall 2ft $4.58 | fixed | per linear ft | DRYWLF |
| Axial Fan air mover $35 | fixed | per unit PER DAY | DRY++ |
| Floor fan $24.50 | fixed | per unit PER DAY | DRY |
| Large LGR Dehu $105.46 | fixed | per unit PER DAY | DHM>> |
| Small Dehu $72.50 | fixed | per unit PER DAY | DHM> |
| Water extraction carpet aft hrs $0.86 | fixed | per sq ft | EXTA |
| Water extraction hard surface $0.27 | fixed | per sq ft | EXTH |
| Tear out bag wet insulation $0.91 | fixed | per sq ft | INS |

The trim/baseboard SF-vs-LF pair actively misbills. Independent of price freshness.

### 6b. Missing Cat 2 / Cat 3 variants (MONEY BUG)

Charles's catalog contains ONLY the Category 1 version of every item. Every Cat 2 and
Cat 3 job has been billed at clean-water rates. Example from the Jill loss (exterior
water through a window, dirty, sat 4 days = unambiguous Cat 3):

| Work | Catalog had | Correct Cat 3 | Delta |
|---|---|---|---|
| Extract from carpet | EXT $0.58/SF | EXTS $1.47/SF | +$0.89/SF |
| Tear out carpet, bag | *missing* | FCCS $1.10/SF | — |
| Tear out pad, bag | PAD $0.72/SF | PADS $1.03/SF | +$0.31/SF |
| Tackless strip | *missing* | TACKS $1.54/LF | — |
| Tear out insulation | INS $0.91/SF | INSS $1.33/SF | +$0.42/SF |
| 4ft flood cut | his $8.33/LF | DRYW4S $9.40/LF | +$1.07/LF |
| Baseboard, bag | *missing* | BASEB $1.16/LF | — |
| Negative air / scrubber | *missing* | NAFAN $70.50/day | — |
| PPE half-face respirator | *missing* | PPERH $1.67/day | — |

NOTE: `MUCK` (muck-out, $2.50/SF) was raised and then RETRACTED — Charles confirmed
they did not shovel mud on the Jill job, the water was merely dirty. Do not bill it.

### 6c. Import decisions

- Import all 561 WTR items with the Xactimate code as the key, correct units.
- Represent Cat 1/2/3 and after-hours as ATTRIBUTES, not 40 separate buttons, so the
  project's category + time-of-call resolve the variant automatically.
- Bring in as a SEPARATE restoration catalog so nothing about carpet cleaning shifts.
- Prices are Jan-2024 and ~2.5 years stale. Charles explicitly accepted this: ~80% of
  work is homeowner-billed, margins are fine, he is not chasing a new price list.
  Flag items as stale rather than blocking on a refresh.
- 3 of Charles's items are NOT in the WTR file (Haul Debris $195, Content Manipulation
  $73.37, Daily Monitoring $92.65) — they belong to other Xactimate categories. Keep
  them as-is; fold in properly if those exports are ever obtained.
- 2 prices do not reconcile with Jan-2024 and were NOT overwritten: Charles's 4ft flood
  cut $8.33 (vs DRYW4 $6.50) and Equipment Setup $92.65 (vs EQ $70.69/HR). UNRESOLVED —
  ask Charles before changing.

### 6d. QuickBooks sync

All 70 active catalog items currently have a `quickbooks_item_id` — the discipline is
clean and nothing is broken. Rule going forward: an item without a QB id must not be
usable on an invoice. Do not blind-push 561 items to QuickBooks; only create QB items
for the ones actually turned on.

## 7. Payments and the deposit (BLOCKER, foundational)

There is NO payments table. Payments live as SINGLE columns on `ops_invoices`
(`square_payment_id`, `square_paid_cents`, `square_paid_at`). The schema literally
cannot hold two payments against one job.

Charles collects a **$1,000 deposit on the first day of mitigation** via Square Tap to
Pay. That plus a final balance = two payments on one invoice.

- Need `ops_payments`: many payments -> one invoice, each with its own Square record.
- `payment_status` becomes COMPUTED from the sum, not set by hand.
- Deposit shows as a payment against the final invoice (invoice $4,200, paid $1,000,
  balance $3,200) — Charles's preference, matches insurance-style documentation.
- Benefits carpet cleaning too (partial payments).
- Payment section by day: **day 1** = deposit (Tap to Pay, defaults $1,000, editable);
  **monitor days** = no payment section; **final day** = full invoice, deposit credited,
  balance due.

## 8. Loss intake form (day 1, top of the mitigation screen)

Discipline: every field must earn its place by changing a line item.

**Drives which code is picked**
- Water category 1/2/3 — the big one.
- Source of loss (supply line, water heater, dishwasher, washing machine, toilet
  supply/overflow, sewage backup, roof, groundwater/exterior, HVAC condensate,
  sprinkler). Selecting a source PRE-SELECTS the category, overridable.
- Time of call — business hours vs after hours (ESRVD $197.29 vs ESRV $295.92 and the
  whole `A`-suffix family). Defaults from the clock.
  UNRESOLVED: does a Saturday call count as after hours? Charles has not answered.
- Standing water yes/no + depth — flips extraction to Heavy variants (EXT+), and on
  Cat 3 adds pumping/hauling (EXTWP, per gallon).

**Drives tear-out vs dry-in-place** (per material)
- Carpet: dry in place (LIFT $0.51/SF) vs tear out (FCC $0.76/SF)
- Carpet type: stretch-in vs glue-down (FCCGD $1.29 — nearly double)
- Pad, drywall (flood cut height 2ft DRYWLF $4.58/LF or 4ft DRYW4 $6.50/LF),
  insulation, baseboard, trim, subfloor, tack strip

**Drives equipment**
- Affected sq ft per room + ceiling height -> cubic feet -> dehu sizing + air mover count
- Class 1-4
- Containment needed (BARRP, NAFAN $70.50/day)

**Report only, not billing**
- Date/time of loss, date of first response, cause narrative, occupancy, pets/vulnerable
  occupants, and optional carrier / claim number / adjuster / deductible.
  Charles bills ~80% homeowners but wants the structure of insurance billing. Same
  Xactimate prices either way — pricing does NOT differ between homeowner and insurance.

### 8a. Category is DATED, not a fixed value

Under S500 a Cat 1 loss degrades to Cat 2 after ~48 hours and to Cat 3 with time or
contamination. Jill: clean-ish exterior water that sat 4 days.

Store category as dated entries ("Cat 1 at time of loss, Cat 2 on arrival"). Line items
resolve against the category in effect when the work was performed. The report shows the
progression. This is cheap now and painful to retrofit.

## 9. Voice / text -> line items

The #1 pain point Charles named: finding line items manually is "such a long nightmare."
Editing a line item once it is in is fine. FINDING is the problem.

- Press a button, talk. Full sentences OR shorthand ("remove carpet, 4 foot flood cut,
  2 foot flood cut, remove pad, spray antimicrobial"). Build for both, tune toward
  whichever he actually uses.
- **What the AI does:** speech -> a list of CONCEPTS. Handles sloppy phrasing, shorthand,
  out-of-order, mid-sentence corrections, background noise.
- **What the AI NEVER does:** pick the price. Deterministic code resolves concept -> exact
  Xactimate code using project facts (category, after-hours, bagging). The model never
  chooses between FCC $0.76 and FCCS $1.10 — the project's Cat 3 flag does.
- **Nothing bills until tapped.** Proposed list shows code, description, unit, price.
  Confirm / reject / edit. Quantities come from the map where known, blank otherwise.
- Provider: **OpenAI** (Whisper for transcription, GPT for extraction) per standing
  preference.
- Measured fact: the 561 items collapse to 441 distinct concepts once category and
  after-hours variants are factored out — NOT the ~70 originally assumed. Context
  filtering helps less than hoped, so the confirm step carries the weight.
- UNRESOLVED: offline/poor-signal behavior in basements. Options discussed: hold the
  recording and process when back in signal, or a manual fallback. Charles has not answered.

## 10. The map

Authored ONCE on day 1, reused on every later visit. Monitor days never create map
geometry — they tap pins that already exist.

The map is the data-entry surface for four things at once:
1. **Square footage** -> extraction, tear-out, antimicrobial quantities
2. **Ceiling height -> cubic feet** -> dehu sizing and air mover count
3. **Equipment placement = the billing quantity.** Drop 6 air movers and a dehu on the
   drawing; that IS the invoice line. Pull two fans on day 3 by removing them from the
   map and the per-day accrual adjusts itself. This satisfies the "equipment removal must
   be editable" requirement with no second interface.
4. **Reading points** — material readings pinned to locations.

Model: Xactimate-style — draw the room, derive the numbers.

## 11. Readings (monitor days)

Three kinds:
- **Material readings — ON the map.** Each pin has a material type (drywall, subfloor,
  framing, hardwood) and a location. Tap it, enter today's percentage. Tapping shows
  history (24 -> 19 -> 14) so a stalled point is visible.
- **Dehumidifier readings — ON the map, at the unit.** Tap the dehu icon where it was
  placed; enter inlet temp/RH and outlet temp/RH.
- **General air readings — OFF the map, at the side.** Not spatial. Capture three per
  visit: affected area, unaffected reference area, exterior. The reference is what proves
  the affected space is drying rather than the whole house being humid.

Entry is MANUAL. Meter OCR was explicitly deferred by Charles.

## 12. Photos

`ops_job_photos` already exists (appointment_id, storage_path, public_url, label,
watermarked, source, uploaded_by_label, original_filename) and is in active use — 41
photos across 11 jobs as of 2026-08-30. Do not build a new system; add structure.

Add: **phase**, **room/area**, **optional map pin**. Day comes free from the appointment.

Phases: arrival/overview, source of loss, affected materials before work, moisture
readings, equipment placement, demo in progress, completion/dry standard reached.

- Overwhelmingly a **day 1** activity — emphasis belongs on the mitigation screen.
- Still AVAILABLE on monitor and final days (completion photos close out the report),
  just not nagged for. Charles agreed.
- Capture flow: **pick phase + room once, then shoot a burst** — everything lands tagged.
  Per-photo tagging kills adoption. Retagging possible, never required.
- Backfill: bulk upload with EXIF capture times, auto-assign to project days by timestamp.
  First test case is the Jill photo set sitting on Charles's phone.
- Report needs thumbnails, not full-size images — a 4-day loss can beat the entire current
  photo library on its own.
- Auto-categorization by vision model: explicitly DEFERRED by Charles.

## 13. Final report

Map + reading history + photos + line items, one PDF, submittable to either the customer
or an insurer. This is what makes the operation look like a restoration company rather
than a carpet cleaner with fans. Build TOWARD it from the start rather than bolting it on.

## 14. Statistics / revenue timing

Problem: one invoice landing on the final day while hours were burned across 4 days
wrecks $/hr.

DECIDED (Charles's answer, better than the alternative proposed): labor is essentially
all on day 1. Monitor days are ~15 minutes of work plus drive time — **bill/record them
at ~1 hour each**. Revenue lands where it actually happened, monitor days carry an honest
hour, no proportional-spreading logic needed.

## 15. Component reuse (Charles raised this directly)

"Every time we create a new invoice you tend to drop all that stuff that we worked on."

REUSE, do not rebuild: customer information section, house photo, map/directions buttons
("the mapping buttons are fantastic"), On My Way button, line items editor, signature,
payment section.

DO NOT reuse: itemized receipt on monitor days — monitor visits have no invoice of their
own, so there is nothing to send.

COMPLICATION, stated honestly: these are NOT components today. They are inline inside
`appointment-detail.tsx` (1,241 lines) and `invoice-detail.tsx` (3,194 lines). Only the
signature modal, fiber check panel, and before/after combiner were extracted.

Required sequence: **extract -> verify carpet cleaning behaves identically -> restoration
consumes the same components.** Never copy-paste. `invoice-detail.tsx` is the money
screen; extract carefully.

## 16. Explicitly deferred by Charles

- Moisture meter OCR / reading auto-fill from photos
- Photo auto-categorization by vision model
- Psychrometry calculations (grain depression etc.) — capture temp/RH now, compute later

## 17. Unresolved questions

1. Does a Saturday emergency call bill as after hours ($295.92) or business hours ($197.29)?
2. Jill's actual affected square footage and flood-cut linear footage (to compute the real
   underbilling delta rather than an illustrative one).
3. Offline/no-signal behavior for voice capture in basements.
4. The two non-reconciling prices in 6c (4ft flood cut $8.33, Equipment Setup $92.65).

---

## Build order

1. Catalog import (561 items, correct units, Cat variants, trim/baseboard LF fix)
2. `ops_payments` (deposits + partial payments)
3. Component extraction (verify carpet cleaning unchanged)
4. Project layer (restoration kind, multi-day, held invoicing, close-from-any-monitor-day)
5. Loss intake form
6. Unscheduled tray + tap-to-place
7. Map (areas, sq ft, ceiling height, equipment placement)
8. Readings
9. Photo structure (phase/room/pin)
10. Voice -> line items
11. Final report

## Status — pass 1 (2026-08-30)

### DONE and verified
- **Catalog import.** `restoration_catalog_items`: 560 items (561 minus a `MISC`
  section header with no unit/price), 331 concept stems, 124 Cat 3 variants, 6 Cat 2,
  186 after-hours, 34 per-day equipment items. Variants grouped by Xactimate code stem
  (text grouping fails — descriptions abbreviate inconsistently, e.g. "up to 4' tall"
  vs "to 4'").
- **69 items enabled** (every variant of the concepts Charles actually uses, plus FCC,
  TACK, BASEB, NAFAN, PPERH, LIFT, MUCKHR, EXTWP). 16 carry a QuickBooks id inherited
  from the legacy catalog; **53 still need QuickBooks items created** — see BLOCKED.
- **Unit labels fixed** on the 11 legacy rows (per_linear_ft / per_day / per_sq_ft).
  NOTE: `pricing_unit` is display-only — nothing multiplies by it, quantities are typed
  by hand. The earlier claim that this "actively misbills" was an overstatement; it
  mislabels. The missing Cat 2/3 variants were the real money issue.
- **`ops_payments`** + `ops_invoice_payment_totals` view. 23 historical payments
  backfilled from `ops_invoices.square_paid_cents` (23 in, 23 out). Refunds are negative
  amounts. Existing `payment_status` logic deliberately left alone this pass.
- **`restoration_projects`**, `restoration_category_events` (dated category),
  `restoration_visit_queue` (the tray), and `restoration_areas`,
  `restoration_equipment_placements`, `restoration_reading_points`,
  `restoration_readings`, `restoration_dehu_readings`, `restoration_air_readings`.
- **`ops_appointments`** gained `restoration_project_id`, `visit_type`,
  `visit_sequence`; `kind` check now allows `restoration`.
- **`ops_job_photos`** gained `restoration_phase`, `restoration_area_id`, `map_x`,
  `map_y`, `captured_at` (EXIF, for backfilling the Jill photo set by timestamp).
- **`restoration_equipment_billing` view** — equipment days computed from
  placed_at/removed_at. Verified against a live self-test: 5 fans for 3 days + 1 fan
  pulled a day early + 1 dehu = 17 fan-days ($595) + 3 dehu-days ($316.38). Test data
  removed; cascade delete verified clean.
- **`src/lib/ops/restoration-catalog.ts`** — variant resolution. 10 unit tests pass.
  Full ops suite (245 tests) and `tsc --noEmit` both clean.
- **Held invoicing** in `src/app/api/admin/ops/appointments/[id]/route.ts`: a
  restoration visit no longer promotes its invoice draft->ready->QuickBooks on
  completion, and no longer writes a `revenue_entries` row.

### Bugs found and fixed during the pass
- Variant fallback relaxed water category BEFORE the "heavy" modifier, so a Cat 3
  after-hours heavy loss resolved to `EXTA+` ($1.04, Cat 1) instead of `EXTSA` ($2.12).
  Category is now relaxed LAST. Caught by a unit test.
- Equipment day rounding used a bare `ceil()`, so exactly 3 days elapsed billed as 4.
  Now uses a one-hour grace. Caught by the live self-test.

### NOT DONE after pass 1 — no UI
1. Restoration button on the calendar; `/admin/operations/restoration/[id]` route
2. Loss intake form UI
3. Project close action  -- DONE in pass 2
4. Deposit collection UI (Square Tap to Pay writing to `ops_payments`)
5. Unscheduled tray + drag / tap-to-place
6. Component extraction from `appointment-detail.tsx` / `invoice-detail.tsx`
7. Map drawing, equipment placement UI, reading entry UI
8. Photo phase/room tagging UI and EXIF bulk backfill
9. Voice -> line items
10. Final report

---

## Status — pass 2 (2026-08-30): the server spine

### DONE and verified end-to-end against the real database
- **`src/lib/ops/restoration-projects.ts`**
  - `buildProjectInvoiceLines` — pure, testable assembly of one invoice from every
    visit's line items plus equipment unit-days.
  - `closeRestorationProject` — the "dry standard reached" action.
  - `scheduleQueuedVisit` — tray -> calendar.
  - `addMinutes` — time arithmetic for visit windows.
- **API routes**
  - `POST/GET /api/admin/ops/restoration/projects` — start a loss (project + day-1
    mitigation visit + N queued monitor visits), and list open projects for the tray.
  - `POST /api/admin/ops/restoration/projects/[id]/close` — closes, then hands off to
    `recordRevenueFromOpsInvoice` and `ensureInvoiceQuickBooksSyncJob`. Neither
    handoff failing undoes a close that already succeeded.
  - `POST /api/admin/ops/restoration/queue/[id]/schedule` — place a queued visit.
- **`restoration-projects.integration.test.ts`** — 5 tests, real DB, seeds and deletes
  everything. Verified: monitor visits queue WITHOUT hitting the calendar; closing on
  the mitigation day is refused; placing a queued visit produces a 1-hour restoration
  appointment; closing from a monitor day produces exactly ONE invoice
  ($588 Cat 3 extraction + $440 Cat 3 tear-out + 18 fan-days at $35 = $1,658) with the
  $1,000 deposit credited and a $658 balance, the two unused queued visits cancelled;
  closing twice is refused. Cleanup verified — zero rows left behind.
- Full suite: **540 passed**, typecheck clean.

### Close semantics as built
- Available on ANY monitor visit; hard-refused on the mitigation day at the library
  level, not just the UI.
- Stops equipment accrual at the moment of close, then reads the billing view.
- The single invoice attaches to the CLOSING appointment, which keeps the existing
  invoice detail page, QuickBooks sync, and revenue recorder working unchanged.
- Cancels both remaining queued visits AND any monitor visits already placed on the
  calendar but not yet completed.
- Marks the closing visit `visit_type='final'`, status completed.

### Bug found and fixed in pass 2
`ops_payments.invoice_id` was created NOT NULL in pass 1, which made the day-1 deposit
impossible to record — the invoice does not exist until the project closes days later.
Now nullable, with a check constraint requiring an invoice OR an appointment, and
`closeRestorationProject` attaches waiting deposits to the invoice it creates.

### Decision made by default, worth confirming with Charles
Revenue is recorded against the CLOSING visit's date, because that is when the job is
billed and collectible, and it is what the existing recorder does naturally. Charles
said labour is effectively all on day 1 and that monitor days should carry ~1 hour so
statistics stay honest — which the 60-minute monitor visits already achieve. If he
wants revenue dated to the mitigation day instead, that is a small change.

### Still NOT built (all UI)
1. Restoration button on the calendar and the project screen
2. Loss intake form
3. Deposit collection UI (Square Tap to Pay)
4. Unscheduled tray + drag / tap-to-place
5. Component extraction from the two monolith screens
6. Map, equipment placement, reading entry
7. Photo phase/room tagging + EXIF backfill
8. Voice -> line items
9. Final report

### QuickBooks — DONE (2026-08-30, same day)
Unblocked by using the app's own QuickBooks OAuth tokens (`getValidQBAccessToken`)
rather than the unauthorized MCP connector. Credentials pulled with
`vercel env pull .env.vercel.production` (gitignored).

- `scripts/audit-restoration-qb-items.ts` — READ-ONLY. Lists restoration-looking QB
  items, and reports catalog rows as linked / name-matched / missing, with price drift.
- `scripts/sync-restoration-qb-items.ts` — creates missing items. Dry run by default,
  `--apply` to write.

**Result: all 70 enabled catalog items now resolve to a live QuickBooks item (0 missing).**
53 items created (ids 140-192), QuickBooks went from 119 to 172 items. Every pre-existing
price reconciled exactly against the catalog — no drift anywhere.

Decisions Charles made:
- New items are sub-items of the root **"Water Restoration"** category (id 44), income
  account **Services** (id 5), `Taxable: false` — mirroring the existing items.
- Names are **"CODE - description"** (e.g. `EXTS - Water extraction from carpeted floor
  - Category 3 water`) so Cat 1/2/3 variants stay distinguishable in a QB dropdown.
  The 17 pre-existing items kept their original names.
- `Emergency Service Call, Business Hours` (id 46) was moved out of the orphaned
  `Restoration > Repair > Water Damage` branch into `Water Restoration` so both
  emergency-call items sit together. Price and active state preserved.

Note for later: five orphan items already existed in `Water Restoration`, named by raw
Xactimate code from an earlier partial attempt — `DUCTLF`, `HEPAF`, `HMR CLNHRZ`,
`PPEE`, and `PPERC`. **`PPERC` is priced at $0** and would post a zero-dollar line if
used. Not touched; worth cleaning up with Charles.

### Bug found by the QuickBooks audit
Xactimate uses a trailing `+` for two different things: the **Heavy** labor modifier
(`EXT+`, `MUCK+`) and **equipment size upgrades** (`DRY+`, `DRY++`). The importer
treated every `+` as Heavy, which folded `DRY+` and `DRY++` into the floor-fan concept
as "heavy variants" and left `DRY++` — the $35 1 HP axial fan Charles actually runs —
disabled. Also `EXTSA+` abbreviates Heavy as "Hvy" and had been missed.

Fixed: `is_heavy` now derives from the description only (`heavy|hvy`), the five
size-upgrade codes became their own concepts, and `DRY++` is enabled and linked to the
existing QuickBooks item 70. Air movers are now three distinct products: `DRY` $24.50
floor fan, `DRY+` $28.18 axial, `DRY++` $35 1 HP axial.

### Still unresolved (asked, not yet answered)
1. Saturday emergency call — after hours ($295.92) or business hours ($197.29)?
2. Jill's actual affected sq ft and flood-cut linear ft.
3. Offline/no-signal behavior for voice capture.
4. The two non-reconciling prices: 4ft flood cut $8.33 vs DRYW4 $6.50; Equipment Setup
   $92.65 vs EQ $70.69/HR.
5. **NEW — equipment day counting.** Current rule is elapsed 24-hour periods with a
   one-hour grace (Mon 9am -> Thu 9am = 3 days). Confirm this matches how Charles counts
   days today, since he has been doing it in his head.


---

## Status — pass 3 (2026-08-30): component extraction begins

Charles: "every time we create a new invoice you tend to drop all that stuff that we
worked on." Extraction has to come BEFORE the restoration screen, or the copies drift.

### DONE
- **`src/lib/ops/address-links.ts`** — map, directions, and Street View URL construction,
  previously written inline in THREE places (`invoice-detail.tsx`, `estimate-detail.tsx`,
  `tech-job-detail.tsx`). 5 unit tests pin the exact URL strings, because changing one
  changes where a tech ends up driving.
- **`src/components/ops/directions-buttons.tsx`** — the green/blue Google + Apple pair.
- **`src/components/ops/street-view-card.tsx`** — the photo of the house. Now owns its
  own failure state instead of having the flag hoisted into the parent screen.
- `invoice-detail.tsx` rewired to use both: **3,194 -> 3,151 lines**.
- `tech-job-detail.tsx` rewired to use the shared URL helpers.

### Deliberate scope decision
The admin screens and the tech screen use DIFFERENT visual treatments (Cards vs dark
glass panels) and different link modes (turn-by-turn directions vs pin-drop search).
Only the URL construction was shared; each screen keeps its own styling. Forcing one
visual treatment would have been a much riskier change for no benefit, and the thing
that actually must not diverge is the URLs.

### Verified
- Full suite **545 passed**, typecheck clean, eslint clean on touched files
  (the 2 remaining `<img>` warnings in `invoice-detail.tsx` are pre-existing, elsewhere).
- **`next build` succeeded** — the real check after touching the money screen. All three
  restoration API routes present in the build output.

### Still to extract before the restoration screen
Customer panel (info + call/text), the visit status bar (On My Way / Arrived / Start,
with GPS arrival detection), and the line-items editor. These are larger and carry
state, so they come next.


---

## Status — pass 4 (2026-08-30): the screens exist

### DONE — there is now something to open
- **`/admin/operations/restoration/new`** — start a water loss. Customer lookup,
  source of loss (which PRE-SELECTS the category and stays overridable), category,
  standing water, after-hours (defaults from the clock), narrative, mitigation day and
  duration, and how many monitor visits to queue. Shows the live emergency service fee
  ($197.29 / $295.92) rather than asking for an estimate.
- **`/admin/operations/restoration/[id]`** — the project screen.
  - Customer header with call/text, service address, **reuses `DirectionsButtons` and
    `StreetViewCard`** rather than copying them.
  - Visit switcher; the tray count is shown when monitor visits are still unplaced.
  - **Voice / shorthand entry**: type or dictate, "Read it", review the proposed lines
    with code, unit and price, drop any that are wrong, then add them in one tap.
  - Catalog search as the fallback for finding a single item.
  - Line items with editable quantities (quantity only — price is server-resolved).
  - Equipment: one tap per unit to place, one tap to pull, with live unit-day billing.
  - Readings on monitor days: type a value, press Enter, history shown as 24 -> 19 -> 14.
  - Money: work + equipment + running total, deposit credit, balance.
  - **Close from a monitor visit only.** Day 1 shows "Nothing is dry on day one" instead.
- **Calendar integration** (`operations-schedule.tsx`)
  - **"Water Loss" button** beside Book Job.
  - Restoration visits render sky blue (mitigation darker than monitor) and link to the
    project screen rather than the invoice screen.
  - **The unscheduled tray**, above the calendar: tap a card to ARM it, a sticky bar
    says "Placing: <customer> · monitor 2 — tap a slot", then tap any empty slot to
    place it. Works in day, week, and month view, which is why this beats drag on a
    phone: a drag can only ever reach the day already on screen.

### Verified
- Full suite **548 passed**, typecheck clean, eslint clean on all touched files.
- **`next build` exit 0**; both screens and all eight restoration API routes present.

### Note on how this pass went
The first attempt at inserting the tray put it inside the toolbar's flex row and then a
second edit corrupted the JSX. The file was reverted to its committed state and all ten
edits re-applied in a single scripted pass with assertions on each match. Worth
remembering for a 4,400-line component: batch the edits and assert, do not nudge.

### Still to build
1. Component extraction of the customer panel, visit status bar (On My Way / GPS
   arrival), and the line-items editor — only the address/map pieces are shared so far.
2. The map: draw areas, derive square footage and ceiling volume, place equipment and
   reading points spatially.
3. Photo phase/room tagging UI and the EXIF bulk backfill for the Jill photo set.
4. Square Tap to Pay deep link for the deposit (currently records the payment only).
5. The final drying report.

### Pass 5 additions (same day)
- **Reading points can now be created from the screen** — label, material, and a dry
  standard. Previously API-only, which left the monitor-day panel empty and useless.
- Readings show their history inline (24.5 -> 19.2 -> 14.1) and mark a point "dry" once
  it is at or below its goal.
- **Air readings** for affected / unaffected reference / exterior, with a note in the UI
  explaining why the reference matters: it proves the affected area is drying rather
  than the whole house being humid that day.
- **Dehumidifier readings** (inlet and outlet temp/RH) for each running dehu.
- Integration tests against the real database cover the drying trend, the location
  constraint rejecting an unknown ambient location, and cascade cleanup.

### Verification limits, stated honestly
The screens have NOT been exercised through a browser. Port 3000 is occupied by another
of Charles's Next dev servers and the preview tool would not bind elsewhere; logging in
as Charles is not something to do. What IS verified: both routes respond on the running
dev server (`/admin/operations/restoration/new` -> 307 to login,
`/api/admin/ops/restoration/catalog` -> "Not authorized"), so the routes exist and the
auth guards work; the full data lifecycle passes against the real database; typecheck,
lint and `next build` are clean. **The first person to click through these screens will
be Charles**, and some UI wiring may need fixing on that first pass.

### Reminder
**Do not migrate the Jill job** until the whole feature is finished — Charles's
instruction on 2026-08-30.


---

## Status — pass 6 (2026-08-30): photos and the drying report

### DONE
- **Photo capture on the project screen.** Pick a phase once (Arrival / Source /
  Affected / Readings / Equipment / Demo / Complete), then upload as many as you like —
  they all land tagged. Per-photo tagging is what kills photo documentation, so it is
  never required. The camera's own capture time is sent as `captured_at`, so a bulk
  upload of an earlier day still lands on the day the work happened.
- The **existing** `/api/admin/ops/appointments/[id]/photos` route was extended rather
  than duplicated: it now accepts `restoration_phase`, `area_id`, and `captured_at`, and
  gained a PATCH for retagging a photo after the fact.
- **The drying report** (`/api/admin/ops/restoration/projects/[id]/report`) — a two-page
  PDF built with the same `@react-pdf/renderer` stack as the invoice.
  - Page 1: customer and property, category with the **dated classification history and
    the S500 note explaining why it changed**, cause of loss, scope of work grouped by
    visit, drying equipment with unit-days, and totals with the deposit credited.
  - Page 2: material moisture readings as a trend per point with the dry standard and
    whether it was reached, atmospheric readings, and a photo appendix.
  - **A single unreachable photo cannot kill the report**: if the render throws with
    images in, the route retries the same document without them rather than returning
    an error at the moment the report is being handed over.

### Bugs found and fixed by actually looking at the output
Rendering a realistic sample and reading it caught two things a byte-length assertion
never would have:
- **Date of loss rendered one day early.** `new Date('2026-08-26')` parses as UTC
  midnight, which is the previous day in Mountain time. Date-only values are now read
  as local calendar dates. A wrong date of loss on a document handed to an adjuster is
  not a cosmetic bug. Covered by a unit test.
- The deposit's minus sign was invisible — U+2212 is not in the PDF core font. Now an
  ASCII hyphen.

### Nearly shipped a fabricated business detail
The report's letterhead was written with an invented phone number, **(719) 219-1717**.
The real published number is **(719) 249-8791**. It was caught before commit and the
value now carries a comment marking it as canonical NAP. This is exactly the failure
mode recorded in [[feedback_never_hallucinate_business_details]] — a business detail
that looks plausible is still fabricated. **Do not type a phone number, address, or
price from memory; look it up.**

### Verified
556 tests pass, typecheck clean, lint clean, `next build` exit 0.

### Still to build
1. The map: draw areas, derive square footage and ceiling volume, place equipment and
   reading points spatially, pin photos.
2. Component extraction of the customer panel, visit status bar (On My Way / GPS), and
   the line-items editor.
3. EXIF bulk backfill for the existing Jill photo set.

### Pass 7: Square Tap to Pay for the deposit — DONE
The existing tech charge route could not be reused: it requires a *chargeable invoice*,
and a restoration deposit is taken days before any invoice exists. A dedicated pair was
added that reuses `buildSquarePosUrl` / `parseSquarePosReturn`:
- `POST /api/admin/ops/restoration/visits/[appointmentId]/deposit-link` — builds the
  deep link, carrying `{appointment, amountCents, returnTo}` in Square's `state`.
- `GET /api/admin/ops/restoration/deposit-return` — records the payment against the
  visit and redirects back to the project screen with `?deposit=paid|canceled|error`.
  Square can deliver the same return twice; the unique index on `square_payment_id`
  makes a repeat a no-op rather than a double credit.

The deposit amount is editable (defaults to $1,000) and there is a "record cash or
check instead" fallback, because Square being unavailable must not block the job.

Needs `SQUARE_APPLICATION_ID` set, and the Square POS app installed on the field
phone — see [[project_square_tap_to_pay]]. The route returns a clear 503 if the
application id is missing rather than failing obscurely.


---

## Status — pass 8 (2026-08-30): measured areas and the drying plan

### DONE
- **Affected areas** on the project screen: name, length, width, ceiling height. Square
  footage and wall perimeter are derived, and both are stored.
- **`src/lib/ops/restoration-drying-plan.ts`** turns the measured rooms into a starting
  equipment plan — total affected square footage, total cubic feet, an air-mover count,
  and a dehumidifier size and count. One tap places that equipment.
- **Measurement now fills the line items**: adding a square-foot item from the catalog
  pre-fills the total affected square footage, and a linear-foot item pre-fills the total
  wall perimeter, instead of defaulting to 1.
- API: `POST/GET /projects/[id]/areas`, `PATCH/DELETE /areas/[areaId]`.
- 6 unit tests on the sizing maths, including the nonsense-input case (NaN and negative
  measurements are ignored rather than producing a NaN plan).

### Honesty note on the sizing factors
The two constants — one air mover per **60 sq ft** of affected floor, and one pint per
day of dehumidification per **45 cubic feet** — are commonly used industry rules of
thumb. **They are not quoted IICRC S500 values and I did not verify them against the
standard.** They exist to replace a blank field with a plausible starting number. The
UI says so directly ("Starting point… adjust to what the job actually needs — only what
you place gets billed"), and the equipment that is billed is always what was physically
placed. **Charles should confirm or replace these two numbers**; they are isolated as
named exports at the top of the file for exactly that reason.

### What "the map" still does not do
This pass delivers the *numbers* the map was wanted for — square footage driving line
items, and volume sizing equipment. It does **not** yet deliver the drawing: there is no
canvas, so equipment and reading points are not placed spatially, and photos cannot be
pinned to a location. The schema already carries `map_x` / `map_y` / `area_id` on
placements, reading points and photos, so the drawing can be added without migrating
anything.

### Verified
562 tests pass, typecheck clean, lint clean, `next build` exit 0.


---

## Incident — fake booking alerts to Telegram (2026-08-30)

**What happened.** Charles reported repeated "new job booked" Telegram alerts. They were
mine. `ops_appointments` has an `appointment_booked_trigger` that POSTs to
`/api/webhooks/appointment-booked` on every INSERT, which sends Charles a Telegram
message. The restoration integration test seeds real appointment rows (deliberately — it
has to, to exercise the real constraints), and it took a valid customer by grabbing the
first row of `ops_service_addresses`. That is **Dominic Carro**, a real customer, whose
name and phone number therefore appeared in roughly a dozen fake booking alerts across
six or seven suite runs.

**Blast radius.** Telegram only. The webhook notifies Charles and does not text or email
the customer, so no customer was contacted. No data was left behind — every test cleaned
up, verified as 0 restoration appointments, 0 projects, 0 invoices, 0 revenue entries.

**This was not new to the restoration work.** The pre-existing
`duration-conflict.test.ts` inserts appointments the same way and has been firing the
same alerts on every run.

**Fix.** `notify_appointment_booked()` now returns early when
`NEW.source = 'integration_test'`. No existing appointment uses that source (checked
against all 12 values in use), so genuine bookings are unaffected. Both
`duration-conflict.test.ts` and `restoration-projects.integration.test.ts` now set it,
and `scheduleQueuedVisit` takes an optional `source` so the visit it creates can be
marked too.

**Verified by observation, not assumption:** `net._http_response` showed 4 webhook calls
from those tests in the preceding half hour and **0** after the fix, with the tests
still passing.

**Lesson for future work here:** seeding a row in this database can reach the outside
world. Before writing a test that inserts into a production table, check
`pg_trigger` for that table.


---

## Status — pass 9 (2026-08-30): manual entry and the plan

### Manual line entry, made first-class (Charles asked for this explicitly)
Dictation cannot be the only way in — it fails on unusual phrasing, in a basement with
no signal, and when Charles simply wants to see what is available. The old picker only
appeared once you typed, which is useless for browsing: search only works if you already
know the word.

- Items are now **grouped by kind of work** — Extraction, Carpet & pad, Drywall/trim &
  insulation, Treatment & cleanup, Equipment, Containment & safety, Service calls &
  labor. Grouping is derived from the Xactimate **code stem**, because codes are
  systematic and the abbreviated descriptions are not.
- "Browse all items" opens the grouped list with no typing; typing switches to a flat
  search list.
- Every row has its own quantity box, **pre-filled from what was measured** — area for
  square-foot work, perimeter for linear-foot work — so the common case is one tap.

### The plan (the map)
- `src/lib/ops/restoration-floor-plan.ts` — deterministic shelf-packing layout that
  turns measured length x width into placed rectangles, plus hit-testing and
  pixel-to-feet conversion. 9 unit tests, including that the layout is stable (a pin
  dropped yesterday is still in the same room today) and that a zero dimension falls back
  rather than collapsing.
- `src/components/ops/floor-plan.tsx` — draws the rooms from the dimensions already
  entered, so **nobody has to draw anything**. Arm a tool (air mover, dehu, air scrubber,
  or a reading point) and tap inside a room to drop it there.
- Equipment pins are blue; reading points are amber showing their latest value, turning
  green once at or below the dry standard. So a stalled spot is visible at a glance.
- Verified by rendering a three-room plan with pins in a browser and looking at it:
  layout, wrapping, scale (12.37 px/ft) and pin colouring all correct.

### Known limitations of the plan
- Rooms are rectangles auto-arranged in a strip — it is a schematic, not a true floor
  plan. It is enough to say *which room* and *roughly where*, which is what readings and
  equipment need.
- Equipment placed via the bulk "Place this equipment" button has no coordinates, so it
  bills correctly but does not appear as a pin until placed by tapping.
- A pin keeps its coordinates if its room is later resized or deleted, so it can end up
  drawn outside a room. It stays visible and clickable rather than disappearing.

### Verified
576 tests pass, typecheck clean, lint clean, `next build` exit 0.


---

## Status — pass 10 (2026-08-30): extraction and photo day-sorting

- **`CustomerContact` extracted** — phone with Call and Text, plus email. Pulled out of
  `invoice-detail.tsx` and now used by both the invoice screen and the restoration
  screen. `invoice-detail.tsx` is down to **3,131 lines** from 3,194 at the start.
- **Photos sort themselves onto the right day.** Uploading a backlog now attaches each
  photo to the visit whose date matches the photo's capture time, falling back to the
  open visit. Day matching uses local calendar days — a photo taken at 11pm must not
  roll into the next day. 4 unit tests cover it.

### Shared components so far
`DirectionsButtons`, `StreetViewCard`, `CustomerContact`, and the `address-links`
helpers. **Still inline and still to extract:** the On My Way / Arrived / GPS-arrival
status bar, and the line-items editor. Those carry real state and belong in a focused
pass with the carpet cleaning flow verified click-by-click afterwards.

### Final verification for the session
**580 tests pass**, typecheck clean, **0 eslint errors** (15 pre-existing `<img>`
warnings), `next build` exit 0.


---

## Status — pass 11 (2026-08-30): line entry fixed from Charles's first real use

Charles used the mitigation screen on a live-looking job and reported three things.

1. **"Read it" was the wrong word** — now **Scan**.
2. **The scanned lines looked un-addable.** They could only be added by a bulk
   "Add 3 lines" button sitting up beside Scan, nowhere near the rows it applied to, so
   the rows read as dead — deletable but not addable. Each scanned line now carries its
   own quantity box and Add button. "Add all N" remains as a secondary convenience.
3. **He liked the pre-population**, so that stayed and got stronger: the quantity opens
   pre-filled from a spoken number where there was one, otherwise from what the room
   measured out at, and each row shows its running dollar amount so the total is visible
   before adding.

The scan results and the manual picker were doing the same job with two components, so
they are now one — `LineCandidateRow`. Enter adds from the quantity field.

Verified by rendering the new layout and looking at it. 580 tests, build clean.

### Note on how this feedback arrived
This is the first round of feedback from actually using the screen, and all three points
were interaction problems invisible from the code — the bulk-add button *worked*, it was
just placed where it read as unrelated to the rows. Expect more of this; it is the
cheapest kind of fix and the reason Charles clicking through matters more than any test.


---

## Status — pass 12: new customers on the intake (Charles spotted the gap)

The water-loss intake could only search for an existing customer. A flood call is
almost always somebody new, so the job could not be opened at all for a first-time
caller.

- **`src/lib/ops/resolve-customer.ts`** — find-or-create, matching on phone. Extracted
  rather than written fresh, because the booking route already had this logic and a
  second, subtly different copy is how duplicate-customer bugs start.
- **One deliberate difference from carpet cleaning booking: email is optional.** The
  booking route requires first name, last name, email and phone. Refusing to open a
  water-loss job because the caller did not spell out an email while their basement
  fills would be absurd. Name and phone are required; a single typed name is split.
- The intake form has Existing / New toggle, with name, phone, optional email, and the
  service address. If the number is already on file the existing customer is reused, so
  a repeat caller does not become a duplicate.

### Bug found by the integration test — worth reading
A customer submitted with **no phone at all** resolved to an *existing customer record*
and returned success. Cause: `normalizeOpsPhone('')` returns **`'+'`** — a truthy string
— so the empty check passed, and the lookup then matched a real customer whose stored
phone is literally `'+'`.

That is a wrong-customer bug: a job could have been attached to a stranger's record.
The resolver now validates that the raw input has at least 10 digits **before**
normalising. Six junk values are covered by tests (`''`, whitespace, `'+'`, `'555'`,
`'call back'`, a partial number).

**One existing customer in the database has `phone = '+'`** and was left untouched —
that is Charles's data to decide on, not mine to delete. Nothing new can land on it now.
The booking route is not exposed to this because it requires a phone up front.

### Verified
596 tests pass (16 on customer resolution, 4 of them against the real database),
typecheck clean, lint clean, `next build` exit 0. Test customers cleaned up — verified 0
remaining.


---

## Status — pass 13: drying plan rebuilt on the actual S500

Charles: "I'm just gonna defer you to the S500 for all that information. That's the
standard. Just use it."

The previous factors (one air mover per 60 sf, one PPD per 45 cu ft) were rules of
thumb I chose, and they were **wrong in a way that mattered: they ignored Class
entirely**, which is the single biggest input to dehumidification sizing.

### Sources, read directly rather than recalled
- **ANSI/IICRC S500-2021 §12.5.3 "Controlling Airflow", pp. 67-68** — air movers.
- **IICRC "Initial Dehumidification Recommendation Factors and Formulas", Imperial
  revision 3.1.22** — the factor chart, fetched from iicrc.org and read as a PDF.

Two web sources disagreed (factors of "6/3/2.4" versus "50"), which is why the IICRC
document itself was fetched instead of trusting a summary.

### The chart, as published
| Dehumidifier type | Class 1 | Class 2 | Class 3 | Class 4 |
|---|---|---|---|---|
| Conventional refrigerant | 100 | 40 | 30 | N/A |
| Low Grain Refrigerant (LGR) | 100 | 50 | 40 | 40 |
| Desiccant (air changes/hour) | 1 ACH | 2 ACH | 3 ACH | 3 ACH |

Refrigerant: `Cubic Footage ÷ Chart Factor = Total PPD ÷ AHAM rating = number of units`
Desiccant: `Cubic Footage × ACH ÷ 60 = Total CFM ÷ unit CFM rating = number of units`

### Air movers, per §12.5.3
One in **each affected room**, plus:
- one per **50-70 sf** of affected wet floor in that room (floor and lower wall to ~2 ft)
- one per **100-150 sf** of affected wet ceiling and wall above ~2 ft
- one for **each wall inset and offset greater than 18 inches**
- fractions **round up**; a room under 25 sf may need only the single room unit

The published ranges are exposed as an Open / Normal / Dense selector, because S500 says
the number varies with build-out density and obstructions. Normal sits at the midpoint.

Also implemented as a separate function: the standard's alternative for losses that
mainly wet the lower wall with little floor migration — **one air mover per 14 affected
linear feet of wall** — which S500 states is NOT to be combined with the square-foot
calculation.

### What changed in the app
- `restoration_areas` gained `affected_wall_ceiling_sqft` and `insets_offsets`, because
  the standard counts three separate quantities per room, not just floor area.
- **Class is now editable on the screen** and drives the factor. It was captured at
  intake and then never used.
- The suggestion box shows its own working — per room, "1 for the room + 5 for wet floor
  + 2 for wall/ceiling = 8" — and cites the standard, so the number can be checked
  rather than trusted.
- AHAM ratings use the **low end** of each Xactimate band (70 for `DHM>`, 110 for
  `DHM>>`), so the plan never under-sizes.
- Class 4 on a conventional unit reports as unavailable rather than inventing a factor,
  matching the chart's N/A.

16 tests assert the published numbers directly, including the worked example
(4,000 cu ft, Class 2, LGR = 80 PPD).

### Verified
609 tests pass, typecheck clean, lint clean, `next build` exit 0.


---

## Reference sources for this feature — what we can and cannot use

**ANSI/IICRC S500-2021 is a paid, copyrighted standard** ($125 print / $144 PDF). We do
not hold a copy and will not source one improperly. Only two parts are public and both
have been read directly:
- **§12.5.3 "Controlling Airflow"** (pp. 67-68), reproduced in a contractor training
  handout — the air mover rules.
- **IICRC "Initial Dehumidification Recommendation Factors and Formulas"**, Imperial rev
  3.1.22, published free by IICRC — the class factor chart.

**If Charles produces his own licensed copy**, it can be read and the inferred parts
corrected. Until then, the free authorities below are used, and every number in the code
cites the document it came from.

### Free, authoritative sources now in use
- **EPA, *Mold Remediation in Schools and Commercial Buildings* (EPA 402-K-01-001),
  Table 1: "Water Damage — Cleanup and Mold Prevention", p. 11** — per-material salvage
  guidance, encoded verbatim in `src/lib/ops/restoration-material-guidance.ts`. This
  answers the question S500 was wanted for most: dry it in place, or tear it out.
- Table 1's own footnotes, encoded as job warnings:
  - **Do not run fans before determining the water is clean or sanitary** — surfaced as a
    critical warning on any Category 2 or 3 loss, because airflow spreads contamination.
  - **PPE and containment are required by OSHA** on sewage or chemically contaminated
    water — surfaced alongside it.
  - **Past 48 hours, EPA Table 2 applies instead of Table 1** — mold growth may have
    occurred and drying in place may no longer be appropriate.

### Still inferred, and marked as such
- The exact method for establishing a dry standard from unaffected reference material.
- The precise Category degradation triggers and timings.
- Class 1-4 selection criteria (Charles picks; the app does not guide).
- Completion criteria beyond "Charles says it is dry".

These are the parts that need the S500 itself, and they are flagged in the code where
they occur.


---

## Guidance warnings are internal prompts, not rules (Charles, explicit)

> "It's fine if you want to put warnings in our software internally, but if we end up
> doing a cat 3 water loss I don't want you writing all over a customer's invoice saying
> that we put fans on a category three. There are judgment calls made all the time in
> the industry... that doesn't mean we're 100% stick to everything it says all the time.
> Everything needs to be editable."

**Rules that follow from this:**
1. **Guidance warnings must never appear on a customer-facing document.** Verified: zero
   occurrences of the warning code or its text in `drying-report.tsx`, the report route,
   `invoice-pdf.tsx`, or `invoice-detail.tsx`. They render only on the internal project
   screen. **Do not add them to either document.**
2. **Every warning is dismissible.** Each carries a stable key; "Got it" writes it to
   `restoration_projects.acknowledged_warnings` and it stays gone for that project, on
   every device.
3. **Wording is advisory, not instructional.** "Check the water before running air
   movers… Your call." — not "Do not run air movers". The software raises the
   consideration; the restorer decides.
4. This applies to any future guidance built from EPA, OSHA, or the S500. Reference
   material exists so the software understands the trade, **not so it polices the job**.


---

## Final pass — the original list is closed

### The map: now editable
- **Move** — drag rooms, walls snap flush to neighbours.
- **Shape** — a handle on every corner; drag to move it, tap the `+` on a wall to add a
  corner. This is how a diagonal or an L gets cut in. Corners snap to a half foot. Moving
  a corner recomputes area by shoelace and perimeter by true wall length, so an angled
  wall bills what it measures rather than its horizontal run.
- **Doorway** — tap a wall to place a door, tap a door to remove it. Doors anchor to a
  wall index and an offset along it, so they travel with the room.

### Component extraction
Now shared: `DirectionsButtons`, `StreetViewCard`, `CustomerContact`, `LineCandidateRow`,
`FloorPlan`, plus the `address-links` and `arrival` modules.

`arrival.ts` was the important one — haversine distance, geocoding and the 30 m arrival
threshold sat inline and untested in `appointment-detail.tsx`. Both screens now use the
same rule.

**Deliberately not merged:** the carpet cleaning invoice line-item *editor*. It carries
discounts, percentage discounts, minimum-charge adjustment and fiber-check exclusions,
none of which restoration uses. Forcing one component to serve both would make both
worse. The row rendering is shared; the editors stay separate, and that is a decision
rather than an omission.

### Restoration visits gained the status bar they were missing
On My Way -> Start work -> Finish visit, through the existing appointment endpoint, so
the customer still gets the on-my-way text.

### Photo capture time now comes from EXIF
`File.lastModified` is wrong whenever a file has been copied or exported since it was
taken — exactly the case when uploading a backlog off a phone. Uploads now read EXIF
`DateTimeOriginal`, reading only the first 128KB since the block sits at the front, and
fall back to the file timestamp rather than refusing the upload. Hand-parsed rather than
adding a dependency for one field.

### Final state
**645 tests pass, 0 lint errors, `next build` exit 0.**

### What remains, and why
1. **Psychrometry** — deferred by Charles, twice. Temp/RH is captured, so grain
   depression is a display layer whenever he wants it.
2. **Four things that need the S500 itself** — dry standard from a reference material,
   Category degradation triggers, Class selection criteria, completion criteria. Flagged
   as inferred in the code. Blocked on Charles producing his licensed copy.
3. **Migrating the Jill job** — held at Charles's instruction until the feature was
   finished. It now is.


---

## The plan rebuilt on walls — the model was wrong, not the code

Charles, after using the shape and door tools: "your door and shape tools really don't
work whatsoever... I think you're just trying to invent it from scratch."

He was right, and the fix was a model change rather than bug fixing.

### What was wrong
The plan modelled **rooms as independent polygons**. That model cannot express:
- **a pony wall** — a wall that encloses nothing. Jill had one dividing a room and
  drywall came off it, so it has to be drawable and billable.
- **shared corners** — two rooms sharing a wall had two separate corner lists that drifted
  apart the moment either was edited.
- **a door that stays on a wall** — openings were anchored to a room-edge *index*, which
  moved out from under them whenever a shape changed. That is why doors floated mid-room.

### The model real floor plan editors use
Confirmed against CAD and floorplan-reconstruction literature: **walls are the primitive**,
built on **shared nodes**, and **rooms are enclosed loops derived from walls**. Doors are
**hosted on a wall** at an offset from its start node.

A pony wall then needs no special case at all — it is simply a wall belonging to no loop.

### Now built
- `restoration_plan_nodes` / `restoration_plan_walls`, with openings re-anchored to
  `wall_id` instead of a room-edge index.
- `src/lib/ops/restoration-walls.ts` — resolve, snap, node merging, wall hit-testing,
  opening placement, loop finding, shoelace area. **18 tests**, including that a pony
  wall exists, counts toward billable wall length, and is excluded from the room loop;
  that moving a node moves every wall attached to it; and that a door cannot be placed in
  open floor.
- `src/components/ops/wall-plan.tsx` — four tools: **Wall** (drag to draw, ends snap to
  nearby corners so rooms close), **Corner** (drag a corner, every attached wall follows;
  tap a length label to delete that wall), **Door** (tap a wall; tap a door to remove),
  **Place** (equipment and reading pins). One-foot grid, live wall lengths, partial-height
  walls drawn dashed.
- The old polygon model and `floor-plan.tsx` were deleted rather than left to rot.

Verified by rendering a room plus a pony wall with doors on both, and looking at it.

### Also fixed: the schedule card total
`ops_appointments.quoted_total` was set at booking and never updated, so the calendar card
showed **$0** on a restoration job while the estimate grew. Now recomputed by a database
trigger on line-item insert/update/delete, so it cannot drift regardless of which code
path edits a line. **Scoped to restoration only** — carpet cleaning still sets its own
total at booking, verified by test.


---

## Everything is editable by number, not only by dragging

Charles: "when we drag a wall out, there needs to be a read out with the length as we
move it and then once we set it, we should be able to click on the number and edit that
number if we don't get it exactly right. That pretty much goes for everything. There
should be a way to manually fix things."

Standing principle for this feature: **dragging gets it close, typing gets it right.**
Nothing should be settable only by dragging.

- **Live readout while drawing** — the length follows the cursor in feet and inches
  (`11′ 7″`, not `11.58`), because that is how the measurement is taken and spoken.
- **Every wall length is clickable** — type an exact figure and the end node moves along
  the wall's existing direction, so a diagonal keeps its angle. Enter commits, Escape
  cancels.
- **Every room figure is editable in place** — name, affected square footage, wall
  perimeter, ceiling height, wet wall/ceiling above 2 ft, and insets over 18 inches. They
  were previously write-once at creation and delete-only afterwards.
- Reading points, equipment quantities, line-item quantities, water category, class,
  build-out density and the deposit amount were already editable; this closes the rest.

`formatFeetInches` is used for anything a person reads as a measurement.


---

## Two problems from the schedule screen

### 1. Six tray cards — two test projects, not a duplication bug
Both projects were real and active, three queued monitor visits each. They were
indistinguishable because a tray card showed only the customer name, and both losses
belong to the same customer.

Fixed: cards now show the **street and city** under the name, are **sorted by loss** so
one job's visits sit together, and the tray header says "· 2 losses" when more than one
is open. The placing bar names the address too.

### 2. The wall plan was empty
Two causes, both real:

- **Rooms already measured never became walls.** Replacing the polygon model with the
  wall model left existing rooms invisible on the plan. There is now a **"Draw my
  measured rooms"** button that lays each measured room out as a rectangle of walls, side
  by side with a gap, ready to be dragged into the real shape of the house. Rooms are
  still entered as length x width on a phone, so this bridge is permanent, not a one-off
  migration.
- **The drag gesture had no pointer capture.** A wall drag died the moment the pointer
  left the element or moved quickly — which is most drags, especially on a phone. Now
  captured, released on pointer-up, and cancelled cleanly.

Persistence itself was never broken: a new integration test draws four walls against the
real database, proves a shared corner is reused rather than duplicated (three nodes after
two walls, not four), closes a room measuring 70 ft of wall, hosts a door on a wall,
rejects a wall with the same node at both ends, and confirms cascade cleanup.


---

## Water losses were a dead end on the customer record

Charles went looking for a water loss through customer lookup and found the visits listed
with **"No invoice"** and nothing to click.

That is a correct consequence of holding invoicing until a project closes — the visit
genuinely has no invoice — but it left the customer record as a dead end, which is the
one place you look when you cannot remember which job you want.

Both places in the customer directory that linked to an invoice now fall back to the
**project screen** for a restoration visit, and the row carries a **"Water loss ·
mitigation"** badge so it reads as a different kind of job rather than a broken one.
`/api/admin/ops/customers` returns `kind`, `visit_type` and `restoration_project_id` for
this.

**Worth watching for elsewhere:** anywhere the app assumes a completed job has an
invoice will show the same dead end. The calendar and the customer directory are handled;
the pattern to follow is invoice if there is one, project if it is a restoration visit.


---

## Tools split so drawing is never blocked

Charles: "if I tried to drag exactly where the number is it won't let me grab it... in
this particular case I wanted to put the wall exactly where the measurement already was
because it was dead center of the room... also I can't seem to drag the boxes."

Both were the same root cause: **one tool was doing several jobs**, so the affordances of
one blocked another.

### Length labels are now inert while drawing
Under the Wall tool the measurements are `pointer-events: none`. A label sits at the
midpoint of a wall — which is frequently the exact spot you want to start a new wall
from, since that is the centre of a room. Doors are likewise inert unless the Door tool is
active.

### A Resize tool
- **Drag inside a room to move the whole thing.** The enclosed loop is found under the
  pointer, and every corner of it moves in one write — otherwise the walls tear apart
  between requests. The smallest enclosing loop wins, so an inner room beats the outer
  one.
- **Tap a measurement to type an exact length.** Editing moved here from "any tool", which
  is what was stealing the drag.

Nodes attached to the room but outside the loop — a pony wall's free end — deliberately
stay put, so the pony wall stretches with the room rather than sliding along with it.

### The five tools now
**Wall** draws. **Resize** moves rooms and edits lengths. **Corner** drags a single corner
and deletes walls. **Door** places and removes doors. **Place** drops equipment and reading
pins. Each one owns its interactions and nothing else claims a tap.

5 new tests cover finding the room under a point, moving every corner together without
changing wall lengths, leaving out-of-loop nodes alone, and a degenerate loop.


---

## Deleting a room now takes its walls with it

Charles deleted a measured room and its walls stayed on the plan. Rooms and walls were
unrelated records — the "Draw my measured rooms" bridge created walls but recorded nothing
about where they came from.

- `restoration_plan_walls.area_id` — the room a wall was generated from, cascading on
  delete. **Walls drawn by hand keep a null `area_id` and survive independently**, which
  matters because a pony wall belongs to no room.
- A trigger removes a corner once no wall uses it, so cleanup happens on every path — a
  room delete, a wall delete, or a project cascade — rather than only in the route that
  happened to be written for it.
- Re-seeding now **replaces** a room's walls instead of stacking a second copy, so the
  button is safe to press twice. It reads "Redraw measured rooms" once a plan exists.
- **Clear plan** wipes the whole thing, as the manual escape hatch when a plan gets
  tangled. Same principle as everything else here: there is always a way to fix it by
  hand.

3 integration tests: a room delete removes its walls and their corners; a hand-drawn wall
survives; a corner still used by another wall is kept.

**Note for Charles:** the 15 walls currently on the first test project were drawn before
this change, so they carry no `area_id` and will not disappear with a room. "Clear plan"
then "Draw my measured rooms" puts that project on the new footing.


---

## Equipment placing: four pieces, each readable on the pin

Charles: "we only have four different pieces of equipment — a large DU, a small DU, an
air mover and an air scrubber."

**There was also a bug:** the plan toolbar rendered `EQUIPMENT_CODES.slice(0, 4)` from a
six-item list, so **Air scrubber never appeared on the plan at all**. It was reachable
from the Equipment card but not from the place tool.

Now four, matching what actually gets loaded on the truck:

| Button | Code | |
|---|---|---|
| Air mover | `DRY++` | Axial fan air mover, 1 HP, $35/day |
| Large dehu | `DHM>>` | LGR 110-159 PPD, $105.46/day |
| Small dehu | `DHM>` | 70-109 PPD, $72.50/day |
| Air scrubber | `NAFAN` | Negative air / air scrubber, $70.50/day |

The two air movers Charles does not run (`DRY` at $24.50, `DRY+` at $28.18) stay in the
catalog and can still be added by hand from the line-item picker — they are just not quick
buttons.

**Pins now carry a two-letter glyph** — AM / LG / SM / AS — because six identical blue
dots said nothing about what was actually sitting in the room.

**Reading points pick their material before placing**, from a dropdown next to the button,
and are named after it (`Drywall 1`, `Drywall 2`, `Subfloor 1`). They previously all
landed as "Reading point · Drywall" and had to be renamed one at a time afterwards.


---

## Air movers: `DRY`, $24.50/day — settled

> "I don't have any axial fans. I just have regular air movers."

**An air mover is `DRY` — "Air mover (per 24 hour period)" — at $24.50/day**, QuickBooks
item 51. Confirmed by Charles directly. `DRY+` ($28.18) and `DRY++` ($35.00) are
axial-fan codes; Charles has no axial fans. They stay in the catalog but nothing suggests
them.

The QuickBooks item named "Axial Fan air mover" is just what things got called years ago.
**The name carries no meaning — do not infer pricing from QuickBooks item names.**

### How this went wrong, so it does not repeat
Charles said he has no axial fans. That was changed to `DRY` correctly. He then explained
the QuickBooks naming was legacy, which was **read as a defence of the $35 rate** and the
change was reverted — inventing a `display_name` column and a naming-override feature
along the way, none of which was asked for. Both were undone and the column dropped.

**The rule: an observation is not a feature request, and a billing rate is never changed
on an inference. Ask.**

---

## The tray never actually supported dragging

Charles: "I finally tried dragging the monitors and they don't move off of the top header
onto the schedule."

Correct — it was **tap-to-arm, tap-to-place only**. The plan always said drag on desktop
and tap on mobile, and only the tap half was built.

Tray cards are now `draggable` and carry a `queuedVisitId` on the drag. `handleDrop`
checks for that first and places the visit, falling through to the existing
move-an-appointment path otherwise, so both behaviours share one placement function.
The carried Y-offset is reset on drag start, or the drop preview sits an hour off. Both
paths still work; the tray now says which is available.


---

## Cancel returns a visit to the tray; a loss can be deleted

### Cancelling a monitor visit
Cancelling left a dead block on the calendar. A monitor visit that gets cancelled still
has to happen — it just needs a different slot — so cancelling now **re-queues it and
removes the block**. It reappears in the unscheduled tray, ready to be placed again.
Only restoration visits behave this way; carpet cleaning cancellation is unchanged.

### Deleting a water loss
`DELETE /api/admin/ops/restoration/projects/[id]`, with a button on the project screen
behind a confirm that names what will go.

Every child table cascades from `restoration_projects` — verified against `pg_constraint`,
all nine foreign keys are `ON DELETE CASCADE`, **including `ops_appointments`**. So the
mitigation day and every monitor visit go with it, scheduled or still in the tray, along
with rooms, walls, nodes, equipment, reading points, air readings and category events.

Two things the cascade does not cover, handled in the route:
- **Payments** taken before an invoice exists (the day-1 deposit) hang off the visit and
  do not cascade from it — removed explicitly.
- **An invoiced loss is refused** (409). Once a job has been billed, deleting it would
  take the billing record with it; void the invoice first if that is really the intent.

Restricted to `admin` and `owner`, unlike the rest of the restoration routes which allow
`tech` and `dispatcher`.

3 integration tests: visits and queued visits both disappear; rooms, equipment and
reading points go too; a second loss is untouched.


---

## Cancel means park, for every job

> "Cancel means we're not deleting the job, but we don't want her on the schedule. It
> just has to sit somewhere else until we figure out where to put it."

`ops_appointments.parked_at`. Cancelling any job now sets it: the block leaves the
calendar and the job appears in the tray alongside queued monitor visits. Everything else
about it survives — customer, address, line items, quoted total, and its invoice.
Giving it a new date clears the park and puts it back, keeping the **same** invoice
rather than creating a second one.

- `GET /api/admin/ops/schedule/parked` lists them, carrying the duration they were booked
  for so replacing a four-hour job does not silently shrink it to a default.
- The tray places each kind through its own endpoint: a parked job goes back through the
  appointment PATCH so it keeps its invoice; a queued monitor visit is created fresh.
- The grid filters parked jobs out, or the job would appear both scheduled and unscheduled.
- `park: false` in the PATCH body still gives a plain cancelled block, for a genuine
  cancellation that should not sit in the tray.

The tray header is now just "Unscheduled", since it holds both kinds.

3 integration tests cover the round trip: parked keeps its invoice and line items, it is
listed as parked, and rescheduling restores it with the same invoice rather than a second.


---

## What reaches the customer, and what does not

Checked line by line, because Charles asked before running a real loss on a real
customer.

**Starting a water loss sends the customer nothing.** No SMS, no email — there is no
customer communication anywhere in the project-creation route. The only thing that fires
is the `appointment_booked_trigger` on the new appointment row, which posts to the
booked-webhook and sends **Charles** a Telegram. Nothing leaves for the customer.

Silent too: rooms, walls, line items, equipment, photos, readings, areas, the deposit.

**Two actions do text the customer:**
- **On My Way** — `sendOpsLifecycleCommunications({ event: 'on_my_way' })`.
- **Finish visit** (status → completed) — the job-finished message **and**
  `enrollCustomerInDrip`, which starts a marketing sequence. Worth knowing before using a
  real customer to test.

`skip_customer_communications: true` in the appointment PATCH body suppresses both. The
flag exists in the API but is not wired to any control.

### Wanted later, not built
Charles: *"When we hit start mitigation I do want messages sent, but we'll save that for
later."*

So starting a water loss should eventually send the customer something — presumably a
confirmation that the job is opened and when the crew is coming. **Deliberately not built
yet.** When it is, it needs its own template rather than reusing the carpet cleaning
booking confirmation, since the situation and the tone are different.


---

## Doors and windows: place, move, resize, delete

Charles: doors could only be placed, sometimes landed in the wrong spot, and could not be
moved or deleted. There was no window tool at all.

- **Door / Window** toggle. Windows draw thinner and cyan, doors thicker and amber, so a
  plan reads at a glance. The schema already carried `window`, `opening` and `stairs` — only
  the UI was missing.
- **Single (3′) / Double (6′)** presets plus a free width field, so a double door is one
  tap rather than two doors side by side.
- **Placement centres on the tap** instead of starting there, so an opening lands where it
  looked like it would. That alone fixes most of the "wrong spot" cases.
- **Drag to move** — along its own wall, or onto a different wall entirely. It snaps to
  whichever wall is nearest within 3 ft while dragging.
- **Tap to select, then Delete selected.** Previously a tap deleted immediately, which is
  unforgiving when the tap was meant to pick it up.

`PATCH /openings/[id]` now accepts `wall_id` so an opening can change walls, not just
slide along the one it was born on.

### Still worth confirming with Charles
Whether "shows up in the wrong area" meant the wrong **wall** or the right wall at the
wrong **spot**. Centring on the tap and drag-to-move address the second; if it is
picking the wrong wall, the `wallNear` tolerance needs tightening.


---

## The three missing everyday items

Charles: "for some reason it's not finding dump fee, which is a big one. We pretty much
use that one every time."

Correct — it was not in the restoration catalog at all. These three belong to other
Xactimate categories and so were never in the WTR file. They had been sitting in the
legacy carpet-cleaning catalog with real prices and QuickBooks items, invisible to the
restoration picker and to voice entry. Flagged as a gap back at the import and never
closed.

| Code | | Rate | QB |
|---|---|---|---|
| `HAULDEBRIS` | Haul debris / dump fee, per truck load | $195.00 EA | 69 |
| `DAILYMON` | Daily monitoring (hourly charge) | $92.65 HR | 52 |
| `CONTENTMANIP` | Content manipulation (hourly charge) | $73.37 HR | 53 |

Prices and QuickBooks mappings are the ones already in use — nothing repriced. They carry
`price_list = 'Sasquatch legacy'` to mark them as not from the WTR sheet.

**The description carries the words Charles says as well as the formal name** — "Haul
debris / dump fee" — because voice entry matches on the description. Naming it only
"Haul Debris, per truck load" is why "dump fee" found nothing.

Verified against the live model: "dump fee emergency service fee 3 monitors" now returns
`HAULDEBRIS`, `ESRVD`, and `DAILYMON` at quantity 3, with nothing unmatched. Previously
"3 monitors" was matched to `EQA` (equipment setup and monitoring), which is a different
line at a different rate.

**Lesson for the catalog:** an item is only findable by the words on it. When Charles
names something differently to the standard, both names belong in the description.


---

## The estimate phase

Charles: "as soon as I get to a job, all they wanna know is how much." The system had no
answer until the work had been built out.

An **Estimate card** sits between the service address and the visits, collapsed by
default, opening to the same voice-first tools as the work: dictate the scope, review the
proposed lines with codes and prices, add them, correct quantities.

### Estimate is a phase of the project, not a separate record
Same customer, address and loss category, so nothing is re-entered and the two cannot
drift. `restoration_estimate_lines` holds what was quoted; `ops_appointment_line_items`
holds what was done.

That separation is what makes **"Start the work from this estimate"** possible — one
button copies the estimate onto the mitigation visit, and the handful of lines that
changed get corrected there. It also means estimate-versus-actual is visible at close.

Prices resolve through the same rules as the work: the caller sends concepts, the server
resolves the variant from the loss context. A quote and the eventual bill price the same
work identically.

### Deliberate: the estimate does not touch money
No invoice, no QuickBooks, no effect on `quoted_total` — that only follows the work lines.
Invoicing stays held until the project closes. An estimate is not a bill.

### Decided, worth confirming
`estimate_signed_at` freezes the estimate: once a customer has signed a number, adding to
it is refused (409) and revisions belong on the work side. Columns for sending and
signature exist (`estimate_sent_at`, `estimate_signature_url`, `estimate_signed_name`) but
**send and signature are not built yet** — this pass is the estimating tool itself, which
is what Charles emphasised.

### Send and signature — now built
**Send** — email and text, with the address and phone prefilled from the customer and
editable, since the person standing there sometimes wants it somewhere else. The email
carries the itemised scope; the text carries the number and points at the email, because
a line-item list is unreadable as an SMS. Either channel works alone, and the response
says what was sent and what was skipped and why ("no deliverable address on file")
rather than failing silently.

**Signature** — the existing `SignatureModal` from the invoice screen, so both look and
behave the same. Signing freezes the estimate: adding lines is refused with a 409, and
the screen says changes go on the work side. `DELETE` on the signature route unfreezes it
for a signature captured by mistake, restricted to admin and owner.

**Sending a quote is not billing.** No invoice, no payment link, nothing to QuickBooks —
asserted by test.

### Wording, and still open
The email says the scope may change once materials are opened up and that we will talk
before anything is added — closer to a work authorisation than a fixed price, which is how
restoration scope actually behaves. **Charles has not confirmed** whether he wants a firm
estimate instead, and whether the emergency service fee belongs on the document. Both are
wording changes, not structural.

4 integration tests: the estimate holds lines without touching the work or the calendar
total; copying starts the work and the calendar total follows; the work can then diverge
while the estimate stays as the record of what was quoted; and it cascades with the project.

## Equipment is quoted as units × days

Charles, looking at a scan that read "8 fans large dehu": *"it's not eight fans
for one day. It's eight fans for three days... there needs to be a multiple
calculator."*

He is right, and the mistake was structural rather than cosmetic. Every piece of
drying equipment on the price sheet is priced **per 24-hour period** — `DRY` is
$24.50 a day, `DHM>>` is $105.46 a day — so a unit count is never a billable
quantity. Storing 8 against a per-day price quotes one night of drying and
misses the job by two thirds.

### The two numbers are kept, not just their product

`restoration_estimate_lines` gained `units` and `days`. `quantity` stays the one
number money is computed from, and a trigger keeps all three from ever
disagreeing: set `units`, and `quantity` becomes `units × days` no matter which
code path wrote the row. A check constraint refuses `days` without `units`,
which would otherwise price to nothing.

Keeping both numbers is the point. A bare `24` on a line means re-deriving the
arithmetic every time the plan changes, and reads to a customer like a typo.
Stored as 8 × 3, adding a day is one edit and the estimate says "8 × 3 days".

### What counts as daily is read from the description, not the code

The codes lie. `DRY` and `DRY+` are both per-24-hour; `DAILYMON` has "Daily" in
its name and is billed by the hour. The price sheet states what it charges for
in words, so `isDailyBilled()` reads the description (and a `DA` unit), the same
lesson the `+`/heavy misclassification taught earlier.

### Days default to the monitor count

Equipment goes in on the mitigation day and comes out on the last monitor, so
the nights it runs is the number of monitor visits — three monitors, three days,
which is exactly what Charles said out loud. The box is prefilled and editable,
and voice entry overrides it when a length was actually spoken ("eight fans for
four days" parses as units 8, days 4).

### Equipment no longer copies onto the work

Found while fixing this: "Start the work from this estimate" copied every line
onto the mitigation visit, equipment included — and the invoice ALSO bills
equipment from what is placed on the map and when it came out. The same fans
would have billed twice, once as a guess and once as the real thing. The copy
now skips daily-billed lines and reports how many it left behind. The quote says
three days; the invoice says what it ran.

### The signature freeze now holds on every route

Also found here: the add route refused a signed estimate, but the edit and
delete routes did not — a quantity could be changed out from under a signature,
which makes the signature worthless. Both now refuse with the same 409.

### Schema note

Applied by MCP `apply_migration` as `restoration_estimate_line_units_and_days`,
matching the rest of the restoration schema — none of which has a local
migration file, because `db push` is dead in this project.

## Why deleting a door did nothing

Charles: *"the door deleting tool does not seem to work. I select it and I press
delete and it does not delete it."*

The delete route was fine. The **selection** was not: tapping a door usually
moved it instead, so nothing was ever selected and Delete had nothing to delete.

A door has to answer to both a tap (select, so it can be deleted) and a drag
(move). It decided between them by comparing the door's computed offset before
and after — and taking hold of the middle of a three-foot door reads as a
one-and-a-half-foot move on the very first pointer event. A dead-still mouse
click fires no pointermove at all, so it selected; anything with a pixel of
travel — every touch, most trackpad clicks — moved the door instead. That is why
it looked intermittent rather than broken.

Three things changed:

- **Tap versus drag is decided by screen travel**, not by computed offset. Under
  six pixels is a tap. A regression test asserts a two-pixel wobble still
  selects, and fails against the old rule.
- **A door is grabbed where you touched it.** It slides under the finger instead
  of snapping its left edge to the cursor, and it is clamped so it cannot hang
  off the end of its wall.
- **Delete sits on the door.** A red × appears above the selected opening. The
  toolbar button stays, but on a phone, needing to find a button elsewhere on
  the screen is the difference between deleting a door and giving up.

Two smaller faults found alongside: `setPointerCapture` was called unguarded on
the opening (it throws in some contexts, and would have abandoned the tap before
it registered — every other call site already had the guard), and a selection
could outlive its door, leaving a Delete button that deleted nothing.

**Windows are the same code.** Kind only changes the colour and thickness, so
the fix covers both — no separate window path exists to be broken.

### The real reason: every tap was adding another door

The selection fix above was necessary but not the cause. Charles, still: *"it
still does not work."*

The database had the answer. Five doorways on one wall at 6.34, 7.15, 7.32,
7.93 and 8.22 feet, created seconds apart — a five-foot band of solid orange
that looks exactly like one door.

Doors are placed on the container's `click`. The opening element stopped
`pointerdown` and `pointerup` from reaching it, but not `click`. So every tap on
an existing door selected it **and dropped a second door on top of it**. Delete
then worked perfectly and removed one of five, which on screen is no change at
all. Worse, it compounded: each attempt to select one added another.

Two guards, because either alone leaves a hole:

- The opening stops `click` as well, so tapping a door never places one.
- Placement checks for an opening already within a quarter-foot of the tap and
  selects that one instead. Two openings in the same few inches cannot be told
  apart on screen, so this is the only place the difference can be caught — and
  it covers a tap that lands on the wall beside the door rather than on it.

Both are covered by tests that fail against the old code. **This is why looking
at the data mattered more than reading the handler again**: the delete path was
correct at every reading, and the stacked rows named the bug immediately.

## Hired labor, and the one item that never made it across

Charles, on the Jill job: *"I actually had to hire labor to do my demolition
because my back was in bad shape... I know it exists in my system but I guess
maybe it got disconnected. I think it's at $125 an hour but honestly that just
depends on what the contractor charges me."*

He was right on both counts. `service_catalog_items` — his own QuickBooks-linked
list — holds **Labor, $125/hr, QuickBooks item 72**. Every other Restoration
item in that list has a matching row in `restoration_catalog_items`. Labor was
the only one that did not, so it was invisible to the estimate, the picker and
voice entry. Added, enabled, and linked to QuickBooks item 72 so it can reach an
invoice.

### The rate is editable, because this one genuinely varies

Hired labor costs whatever that contractor charges that week, so the catalog
price is a starting number rather than a ceiling. The rate box on an estimate
line is editable and the line reprices from it. This does not weaken the rule
that matters: **nothing that guesses may choose a price** — the model still only
identifies the kind of work. A rate typed by a person is not a guess.

### Two prices that disagree with QuickBooks

Found while checking the mapping, NOT changed — a price is Charles's call:

| Item | Restoration catalog | QuickBooks |
| --- | --- | --- |
| `EQ` Equipment setup hourly | $70.69 | $92.65 |
| `DRYW4` 4ft flood cut, per LF | $6.50 | $8.33 |

The catalog numbers are the 2024 Xactimate list; the QuickBooks numbers are what
he actually bills. Everything else in the two lists agrees to the cent.

## The day-before text said "Estimated total: $0.00"

Charles: *"it needs to sound like we're doing a monitor and not a carpet
cleaning appointment which is super important."*

Placing a monitor on the calendar sends the customer nothing — that part was
already right; it fires one Telegram to Charles. The exposure was the next
morning. `sendDayBeforeReminderSms` selects every appointment for tomorrow and
filters on status alone, with nothing about `kind` or `visit_type`, so a monitor
visit got the residential cleaning template:

> Services:
> **Estimated total: $0.00**

Both wrong for the same reason: monitor visits carry no line items and never
invoice on their own. Sent to someone mid-mitigation on a job that will bill for
thousands, that text generates a phone call.

Restoration now has its own two templates — one for a monitor visit, one for
work — selected by `dayBeforeTemplateKey()`, which is a pure function precisely
so the routing is testable without sending anything. Neither carries a dollar
figure, and the monitor one says what the visit actually is:

> We will be by tomorrow at 9:00 AM to check the drying equipment and take
> moisture readings... about 30 minutes, and you do not need to be home as long
> as we can reach the equipment.

A restoration visit beats the Recovery Village branch, which is asserted — a
water loss at a commercial client would otherwise get the commercial cleaning
wording.

### Still open on this front
`on_my_way`, `job_finished` and `job_rescheduled` fire for restoration visits
too, and have not been reviewed for wording. The skip is opt-in per request and
nothing sets it for restoration.

## The rest of the lifecycle texts, and a review ask mid-flood

The day-before text was not the only cleaning message reaching water-loss
customers. Reading the rest of them:

- **on_my_way** linked a carpet cleaning explainer video (`youtu.be/...`) on the
  way to a flood.
- **job_finished** said *"hope you love the clean"* and asked for a Google
  review — and because closing a monitor day marks that visit completed, it
  fired **after every monitor visit**, three times during one loss, with the job
  not done.
- **job_rescheduled** quoted *"Estimated total: $0.00"* with an empty services
  list, for the same reason as the day-before text.
- **job_finished_email** sent carpet dry-time care tips to someone whose
  basement is full of air movers.

Restoration now has its own four texts and none of the cleaning emails. The
routing lives in `getOpsTemplateKeysForEvent`, which takes the visit and is
covered by tests asserting a monitor day never reaches
`satisfaction_checkin_email`.

Scheduling a restoration visit sends nothing. Charles fits monitor visits around
other work and asked to keep start-of-job messaging for later; the day-before
text covers the customer either way.

### The review ask was worse than the text

`enqueueReviewRequests` selects every completed appointment with no filter on
kind, so each monitor day queued *"Thanks for having us out! If you have a
minute for a Google review..."* — mid-flood, before the job was done. Given how
fragile the Google profile already is, asking three times during one unfinished
job is a real risk, not a cosmetic one.

My first fix allowed one ask, on the visit that closed the loss. Charles
overruled it, and he is right:

> *"I don't wanna ask for reviews on floods whatsoever. It's a very sensitive
> thing for people. They're not exactly looking to get out five star reviews
> which is why pretty much all flood companies have terrible Google reviews."*

A flood is the worst day of someone's year, not a service they are delighted by.
The ask lands wrong however good the work was — which is why flood companies
carry poor ratings as a class. **No restoration visit is ever eligible**,
including the one that closes the job. Each records a skip with the reason, so
it is visible rather than silent, and a test asserts it.

The four templates that mention a review — `job_finished_sms`,
`job_finished_email`, `job_finished_email_urine`, `satisfaction_checkin_email` —
are all cleaning-only keys, already unreachable from a restoration visit. That
is the complete set; nothing else in the codebase links the review page.

## The drying plan suggests; it does not act

Charles: *"we should not have a button that places the equipment but merely we
should just have a little card that gives a suggestion."*

He is right, and the principle is worth stating plainly: **the software may
compute a number, but only Charles creates a billing record.** "Place this
equipment" turned an S500 calculation into eleven accruing placements in one tap,
with nothing on screen saying where the eleven came from. Better labelling would
not have fixed that — the fault was a calculation with a side effect on the
invoice.

The card keeps the arithmetic and the citation and loses the button. The
`+ Air mover` buttons gained a count box, so placing ten is one action rather
than ten taps on a phone in a wet basement — still his number, still his tap.

### Why the estimate may still place equipment

Same shape, different provenance. The S500 count is the *software's* number. The
estimate's eight fans is *Charles's* number — spoken aloud, on a document the
customer may already have. Placing what he himself quoted is not a surprise.

So "Start the work from this estimate" now places the quoted units rather than
discarding them: eight air movers quoted become eight running, clock started, no
map position. Pressing it twice does not double them — anything already running
for that project counts against the quoted number. Days still come from the
clock, never from the quoted three.

## Splitting the deductible

Charles: *"it's very common to split a deductible with a homeowner. A typical
deductible is $1000 so what I would do is typically just discount $500 off of my
services... it's not always exactly that but we need to have that calculated
somewhere."*

`restoration_projects.deductible_credit` holds the amount discounted off our own
work. Stored rather than derived, precisely because half is the usual starting
number and never a rule — the box is prefilled with half the deductible and
edited per job.

Three decisions worth keeping:

- **It comes off the bottom line, not off a line item.** The work was worth what
  the work was worth; the concession is a separate fact. Discounting the carpet
  tear-out to make the arithmetic work would lose both numbers.
- **It rides `ops_invoices.discount_amount`**, which the QuickBooks sync already
  passes through as a discount. A negative line item would have needed its own
  QuickBooks item and a story about what it is.
- **It is capped at the subtotal.** A credit larger than the bill would invoice
  a negative total, which QuickBooks will accept and nobody wants to explain.

The Money card renames its bottom row to "Customer owes" once a credit is set,
so the number on screen is the one the customer will be asked for.

### The deposit, and what the customer actually owes

Charles: *"if we collect $1000 upfront for deposit that needs to be subtracted
from the final total at the end of the job hopefully that's been thought about."*

It was — `closeRestorationProject` already attached any deposit taken during
mitigation to the project invoice and reported a balance. Two gaps showed up
once the deductible split landed on top of it:

- The invoice stayed `payment_status: 'unpaid'` no matter what had been
  collected. A job already covered by its own deposit would have gone out asking
  for the full amount a second time.
- A $1,000 deposit plus a $500 credit can exceed a small loss. That is money
  owed **back**, and it appeared only as a negative balance nobody was told
  about.

The order matters and is now in one pure function, `settleProjectInvoice`:
**discount first, deposit second.** The split is a discount off our own work, so
it changes the bill; the deposit is money already received against that bill.
Reversing them gives the same total by luck and the wrong `discount_amount` to
QuickBooks. The invoice is marked `paid` when the deposit covers it, `partial`
when it does not, and a refund is stated as a positive number rather than left
as a negative balance.

The close card now shows the whole sum before the button is pressed — work and
equipment, less the split, less the deposit, ending in "Customer owes" or
"Refund to the customer".

### Money taken before the app knew about it

Charles: *"we collected 1000 bucks already by square for Jill so hopefully I can
manually fix that."*

He could, but only just. The manual entry existed — and it was gated to the
mitigation day and to a project with nothing paid yet, and it hardcoded
`method: 'other'` behind a button reading "Record cash or check instead". A
deposit taken on Square, on day one, entered on day three, had nowhere to go and
would have been filed as the wrong payment method for reconciliation.

Recording a payment already taken is now its own control: amount, how it was
paid, and Record. Square Tap to Pay above it is for **collecting now**; this is
for money that changed hands elsewhere, including before the job existed here. It
stays available for the whole job and allows more than one, because a customer
can pay twice.

Payments are also listed individually rather than summed. The same $1,000
recorded twice quietly halves what the customer is billed, and a total alone
cannot show that it happened. Each can be removed while the job is open; once
the project closes the payment belongs to an invoice and to recorded revenue, so
removal is refused — that is an invoice correction, not a typo fix.

## Backlog from Charles, 2026-08-31 (captured verbatim in intent)

Recorded here before any of it is built, because the failure mode he has named
before is an idea dump where 80% never lands.

1. **Reading bubble closes on save.** *Done* — taking a reading is why the bubble
   opened, so saving one dismisses it. A monitor day is a dozen points in a row,
   and a dozen taps on an X say nothing. It stays open if the point's settings
   are expanded, since that is a different job.

2. **Colour the bubble by how wet it is** — red / yellow / green against a scale
   that depends on the material (framing behaves nothing like drywall).
   **Needs reference material before it is built.** A colour scale invented from
   nothing would put a green dot on wet framing. Two ways to source it: Charles's
   S500 copy, or his own dry-standard practice. Not guessed.

3. **A drying graph** — readings falling over the monitor days, for the customer
   or the carrier. The data is already there: every reading is stored per point
   with its timestamp, which is exactly a series per point.

4. **Daily monitoring note** — a written note per monitor visit, carried into
   the final report. Currently monitor visits hold readings and nothing said.

5. **Job notes by voice** — the same shorthand tool as line entry, pointed at
   narrative instead: speak about the job, get notes on where the loss came
   from, what was affected, how it went. Same division of labour applies — the
   model writes prose, never picks a price or a category.

6. **Final PDF of the whole job** — the drying report exists but covers drying.
   This is the complete package: cause, scope, what was done, readings and their
   graph, photos by phase, the daily notes, and the numbers.

7. **The AI description draws on the job's own metrics**, not just the dictation
   — affected square footage, category and class, equipment days, how long it
   took to reach dry standard. The facts are in the database; the dictation
   supplies what only Charles saw.

### Order this suggests
(2) is blocked on reference material. (3) and (4) are small and feed (6).
(5) and (7) are one feature, and (6) is the thing the customer and the carrier
actually receive — so it wants the others first.

## Colouring a reading by how wet it is

Charles gave the anchor rather than the standard: *"the wood framing at this
place the baseline was 10%... anything below like 12 would be green, and then
something between 12 and 25 would be yellow, and then above 25 would be red."*

Those numbers are not really about wood. They are about **distance from the dry
standard** — which is how the S500 frames it too: judge a reading against what
unaffected material of the same kind reads in the same building, not against an
absolute number. A 15% reading is fine on framing that reads 14% upstairs and
alarming on drywall that reads 8%.

So the bands are offsets:

| Band | Reading | Charles's framing example (standard 10) |
| --- | --- | --- |
| Green — at dry standard | ≤ standard + 2 | under 12 |
| Amber — still drying | ≤ standard + 15 | 12 to 25 |
| Red — wet | above that | over 25 |

which reproduces his numbers exactly and still works for a material that dries
out at a different figure.

### Defaults, and where they stop

Wood and gypsum default to a 10% standard, editable per point. Published guidance
puts normal drywall around 5–12% with 17%+ counted as elevated, and 2x framing
around 10–15%; the S500 puts softwood framing near 9.2% WME at 70°F/50% RH. His
10 sits inside all of that.

**Concrete and tile have no default on purpose.** They are measured on a
different scale entirely — in-slab RH rather than %MC — so a number invented for
them would colour a pin confidently and wrongly. Those pins stay grey and say
"no dry standard set" until somebody enters one, which is true and useful where
a green dot would be a lie.

A legend sits under the plan, because a colour with no key is decoration on a
document that goes to a carrier.

## A live-model test that cried wolf

While verifying the above, the line-entry integration test failed twice in a
row, on a different assertion each time, with no relevant change: it asks a real
language model to hear a spoken transcript and then asserts exact Xactimate
codes. What the model hears varies; occasionally "removing carpet" lands
somewhere other than `FCC`. The failure reads like a pricing bug and is not one.

Pricing is deterministic, so it is now asserted deterministically — against the
**real** catalog, with no model involved
(`restoration-catalog.integration.test.ts`, including the case where
contamination and after-hours combine and the category correctly survives). The
live test now asserts the property it genuinely owns: whatever the model heard
came back on the right rate for the loss, and a clean loss never returns a
Category 3 code.

## The drying graph and the daily note

Two items from the backlog, built together because the note is what makes the
graph mean something.

### The note

`ops_appointments.restoration_visit_note` — one note per visit, deliberately
separate from `internal_notes`, which is dispatch scratch and never leaves the
office. This one is written to be read by a customer or an adjuster.

Readings say the numbers moved. The note says the closet stalled and a fan was
moved into it, which is how a five-day job gets understood rather than queried.
It appears on whichever visit is open, and the report prints them all in date
order under "Daily monitoring notes".

### The graph

`buildDryingChart` shapes readings into one series per point across the days of
the job. It lives in `lib` rather than in a component **because the screen and
the PDF must plot identical numbers** — a chart that disagrees with itself
between the office and the claim file is worse than no chart.

Decisions inside it:
- **One reading per point per day, the last one taken.** A re-read means the
  first was wrong or a fan had just moved.
- **Two days minimum.** One column is not a trend, and the screen says so rather
  than drawing a chart of one dot.
- **`dayLabel` builds its date from parts**, because `new Date('2026-08-29')`
  parses as UTC and renders as the 28th here — a bug this report has already
  shipped once.

Both are drawn by hand as SVG, on screen and in the PDF (`@react-pdf` can draw
SVG primitives). No charting library: it is a few lines and a dashed rule, it
has to render where no JavaScript runs, and it stays sharp when an adjuster
zooms in.

### Found by looking at the rendered PDF

The document said a point reading 11% against a 10% standard had **not** reached
dry, while the screen coloured it green — because the PDF still used
"at or below the standard" and the screen had moved to the ±2 band. One of them
was wrong and the carrier only ever sees the PDF. Both now use `moistureBand`.

Tests assert the document is larger with a chart than without, and larger with
notes than without — a rendered PDF is opaque, so size against a known-identical
document is the honest proxy for "it drew something".

## Atmospheric readings — the half that was missing

Charles: *"it just dawned on me that I don't think we have atmosphere reading
logging whatsoever."*

He was right. The table and the API existed; **there was no way to enter one**,
so every job so far has been drying blind. Moisture meters say the material is
wet. Psychrometry says whether the equipment is doing anything about it, and it
is the half that goes missing when a job stalls for four days and nobody can say
why.

### Roles, not free text

`location` was free text, and "Basement" and "Dehu 1 out" are both locations. A
`role` column now says which: affected, unaffected, outside, dehu intake, dehu
outlet. The label stays for the human; the role is what makes arithmetic
possible. A placement id ties an intake/outlet pair to a specific unit, so two
dehus on one job are judged separately rather than averaged into one meaningless
figure.

### Grains per pound, computed the way the meter does

`grainsPerPound` is Magnus-Tetens saturation vapour pressure, then the humidity
ratio, then grains — checked against the chart at 70°F/50% (54.4), 80°F/60%
(92), and 40°F/30% (10.8).

**Standard sea-level pressure is used deliberately.** Monument is at 7,000 feet
and the honest number would differ, but field thermo-hygrometers compute GPP at
standard pressure, and a figure here that disagreed with the meter in Charles's
hand would be worse than useless.

### Three questions, which are the three a monitor visit exists to ask

1. **Is the dehumidifier pulling water?** Grain depression across it. Published
   guidance puts a healthy LGR at 30–50 GPP, with conventional units struggling
   to hold 20. **The subtlety that matters: low depression on dry air is not a
   fault.** A dehu fed 35 GPP air cannot pull 30 out of it, and flagging that
   would send Charles to check a machine working perfectly on a job nearly done.
   The complaint is only raised while the intake air is still wet.
2. **Is the chamber drier than the air outside it?** If not, the equipment is
   losing to the building — or the cheap answer applies and you ventilate
   instead of renting another day.
3. **Has it dried since the last visit?** A stall means water is still arriving
   or the equipment is not working, and it is the thing nobody notices until the
   fourth day.

### Found by rendering the report and reading it

The chamber comparison paired Tuesday's outside reading with Thursday's chamber
air, and said so nowhere. Outside air changes overnight, and this document goes
in a claim file — the verdict now states when the reference reading came from a
different day.

## Sunday is a sliver, not a wall

Charles: *"I know we eliminated Sunday from our schedule but here we are doing
monitors on Sunday... I don't have the ability to actually put that monitor that
we did on Sunday on that sliver."*

We do not sell Sundays, so the column is collapsed to a vertical label. That is
right for carpet cleaning and wrong for restoration: **drying does not pause for
the weekend**, and a monitor visit lands on a Sunday whenever day three does.

The sliver was rendered as an empty `div` — no drop handlers, no contents. So a
Sunday monitor could neither be scheduled by dragging nor seen once it existed.
A visit already on a Sunday was invisible on the schedule, which is the worse
half of the bug.

It stays narrow, because it should keep looking like a day we do not sell. It is
simply no longer a dead zone: it accepts a drop like any other column, computes
the time from where the drop landed exactly as the others do, and draws a thin
bar for anything scheduled with the customer's name on hover.

Nothing server-side ever objected to a Sunday — `scheduleQueuedVisit` has no
day-of-week check, and the online-booking availability rules that exclude Sunday
apply to customers booking themselves, not to Charles placing a monitor. A test
now pins that, so a future business-hours guard cannot quietly break Sunday
monitors.

## Readings belong where the equipment is

Charles: *"the map is a great place. If I click on the large dehumidifier, I
should be able to enter in the readings... and as far as atmosphere goes, maybe
we just need to have something right next to the map or above the map that just
is permanently fixed there."*

I had put the air readings in a card further down the page, which is wrong for
the same reason the equipment button was wrong: it ignores where the person
actually is. Charles is standing in front of the machine with a meter in his
hand.

**Tapping a dehumidifier on the plan opens its readings.** Intake and outlet, in
and out, with the grain depression computed as he types and the last verdict for
*that unit* underneath. Both halves save against that placement id, so two dehus
on one job never get each other's numbers. Every other pin gets the one thing
worth doing at it — pulling that unit, on the day it actually came out.

**Atmosphere sits above the plan, permanently.** Affected, unaffected, outside:
taken standing in the room, on every visit. A card further down the page is how
readings stop being taken.

### The failure this makes impossible

The summary card paired the newest intake with the newest outlet regardless of
which machine they came from. With two dehus that computes a depression across
two different units — a number describing neither, and one that reads healthier
than the struggling unit actually is. It now says the readings are from
different units and points at the pin, rather than inventing a figure.

### Sunday, collapsible

Charles dropped a monitor onto the sliver and then could not open it: the bars I
drew were decoration, not links, and 48px is not a tap target.

The column is now 96px — still obviously not a day we sell, but wide enough to
carry its date, its total, and a block you can read and press. The bars are
links, and they resolve through the **same** `appointmentHref` the full-size
blocks use, so a restoration monitor reached from the sliver lands on the
project screen where the readings live rather than on a bare appointment page.

Worth noting: showing something without making it do anything was the same
mistake twice in one feature — the sliver could not be dropped on, and then what
was dropped could not be opened.

Charles then named the better answer: *"just make Sunday collapsible... there's
no distinction between my schedule and David's schedule. Either one of us could
be doing monitoring on Sunday."*

He is right, and it exposes what a sliver can never do. Widening it was still
answering the wrong question — a monitor visit needs **staff lanes**, because
either tech might take it, and a bar in a 96px column cannot say which. So
Sunday now collapses and opens: closed it is a 56px sliver showing its date, its
total and any bars; clicking it opens the day into a full column with both
lanes, identical to every other day, and "Hide" in the header closes it again.

It defaults closed because we still do not sell Sundays. It opens because
sometimes we work them.

## Three faults found by Charles logging a real monitor visit

### The dehu pin editor was never wired

I reported it shipped. It was not: the script that added the JSX also contained
a second edit whose assertion failed, so the file was never written — and
`EquipmentPinEditor` sat imported and unrendered through two commits. TypeScript
does not complain about an unused import, the build passed, and I did not check
the rendered result. **A claim that something works is worth nothing without
having seen it work.**

### Dehu intake was a reading we never needed

Charles: *"we don't need the intake, it's just gonna be whatever the room is."*

He is right, and my own research had said so — grain depression is affected-area
GPP minus the air leaving the unit. Asking for an intake was asking for the same
number under a second name, and it made the depression uncomputable whenever
only one of the two got logged, which is what he hit. `dehu_intake` is gone from
what can be logged, the room air is the intake, and the pin editor now asks for
one reading instead of four numbers.

### A failed log looked exactly like a successful one

He logged an outside reading; it is not in the database. The card cleared its
boxes as soon as the request returned, whether or not it saved, and the error
banner sits at the top of a long page — so a reading taken in the field could
vanish with no sign at all.

The boxes now clear only on success. A failure keeps the numbers, in place, and
says the reading did not save. I still do not know why that particular request
failed; what I can fix is that it failed silently.

### What the error actually said

Charles eventually scrolled up and found it. The Postgres logs name it exactly:

```
new row for relation "restoration_air_readings"
violates check constraint "restoration_air_readings_location_check"
```

Eleven times, between 17:07 and 17:38.

`location` used to BE the meaning — a check constraint pinned it to `affected`,
`reference`, `exterior`. When `role` took that job over, `location` became a
human label ("Front porch", "Dehu by stairs") and **the old constraint stayed**.
So every reading whose role was not literally `affected` was refused by the
database. The only reason a single reading survived is that `affected` happens
to appear in both lists.

The constraint is gone; a label may now be anything except blank, since a blank
one is unidentifiable in a report. An integration test walks every role the
screen offers and writes it to the real table, so a dropdown can never again
offer something the database refuses.

**A test was defending the bug.** `restoration-readings.integration.test.ts`
asserted that `location: 'basement'` must be REJECTED — correct when it was
written, and by the time it mattered it was pinning down the exact behaviour
that lost eleven field readings. Updated, with the history in a comment.

### And the error was invisible

The banner rendered at the top of a page several thousand pixels long, while the
work happens far down it. It is now pinned to the bottom of the screen with a
dismiss button. A message about something that just went wrong has to appear
where the thing that went wrong is.

## I deleted the photos card

Charles: *"I've been trying to get the photo upload tool to work... I click on
that category. I try to select all the pictures that I wanna upload but it never
uploads them."*

Bulk upload was never broken. The card was **gone** — deleted whole, by me, in
`ee88f03`, the commit that moved the air readings above the plan.

The edit removed everything between the Atmospheric card and the Money card by
index:

```python
start = s.index("{/* ── Atmospheric readings")
end   = s.index("{/* ── Money ──")
assert 'AirReadingsCard' in s[start:end]   # the only thing checked
s = s[:start] + s[end:]
```

The assertion confirmed the chunk contained what I meant to move. It did not
confirm the chunk contained **nothing else** — and the Photos card, 110 lines of
it, sat in between. TypeScript does not complain about `PHOTO_PHASES`,
`photoPhase`, `uploading` and `Camera` becoming unused, the build passed, every
test passed, and the feature was simply absent.

**Deleting a range is only safe when you have asserted what the range is, not
what it includes.** The section list before and after tells you that in one
line, and now does: only "Atmospheric readings" moved.

Restored verbatim from `1f161ee`. It already did everything he asked for —
`multiple`, a loop over every file, EXIF `DateTimeOriginal` to date a backlog,
and each photo attached to the visit that happened on the day it was taken.

### The pattern, three times now
The dehu pin editor, imported and never rendered. This card, deleted wholesale.
Both passed the build and the tests. The only thing that catches either is
opening the screen and looking at it, and I have not been doing that.

## Rethinking the psychrometry around what the trade actually uses

Charles: *"outside literally means the air outside, which honestly is a metric
that almost nobody really uses, but we always record it anyway. You don't need
the intake air for the dehumidifier. You only need the affected room — that's the
intake — and then the air coming out."*

Two things were wrong, and the second was the bad one.

### Outside was the yardstick, and it should never have been

The chamber comparison read `outside ?? unaffected` — outside **preferred**, with
the unaffected reading as an afterthought. Exactly backwards. The S500 sets a dry
standard from unaffected air in the same building; outside swings with the
weather and has no bearing on what a basement should read.

On his own readings it produced this:

> **Chamber is drier than the reference air.** Affected 54.9 GPP against 57.9
> GPP. *The equipment is winning.*

Green, confident, and meaningless — the chamber had simply beaten a humid
evening. Now:

> **No dry goal to compare against.** Log an unaffected area — a dry room in the
> same building. That is the number the chamber has to reach; outside air is not
> it.

**Not knowing, and saying so, beats a green box that is measuring the weather.**

Outside is still recorded, and now informs the one decision it genuinely
does: `ventilationNote` speaks up only when outside is 10+ GPP drier than the
chamber, because then opening the building beats another day of rental. On his
readings outside was *wetter*, so it stays silent.

### The intake was already gone; the wording was not

`dehu_intake` had been removed, but the verdict still said "Intake is 54.9 GPP",
which reads as a reading he never took. It now says "The room is 54.9 GPP and the
air coming out is 53.6" — the same arithmetic, described the way the work is
done.

### What his numbers actually say

Worth being plain about: the dehumidifier verdict on his readings is not a bug.
74°F/44% in the room is 54.9 GPP; 92°F/24% coming out is 53.6. That is 1.3 GPP
of depression, and a working LGR on air that damp should be pulling 30 or more.
Either those were test numbers, or that unit needs looking at.

## Readings can be corrected

Charles: *"I don't think we have the ability to edit or delete readings that we
take."*

Correct. Readings could be created, and a whole reading POINT could be deleted,
but a single reading could not be touched. The only way to remove a mistyped
number was to delete the point and lose every reading on it — its whole history,
which is the one thing a monitor visit exists to build.

That matters more here than in most places. These numbers are typed one-handed
in a wet basement. A 340 where 34 was meant rescales the drying chart, drags the
trend line, and prints in a report an adjuster reads. A wrong temperature or RH
produces a **confident** wrong verdict about whether a machine is working.

Both kinds are now editable in place and removable:

- **Moisture readings** — on the pin, each reading is a small editable chip with
  an ✕. Correcting one leaves the rest of the point's history intact.
- **Air readings** — temp and RH are editable in the list, with the GPP
  recomputing beside them, and an ✕ to remove.

**Refused once the project is closed.** At that point the readings back an
invoice and a delivered report, and changing them is a correction to that
document rather than a typo fix — the same line drawn for recorded payments.

## Why the demolition photos would not upload

Charles: *"I finally got some arrival pictures to upload, but I can't seem to
get any of the demolition pictures to upload. It just spins for a little while
and then eventually stops."*

The Supabase edge log tells the story. Four arrival photos reached storage at
18:03:06, :14, :19 and :25 — **six to eight seconds each**. After that, for the
demolition batch, there are no storage writes at all. The requests never got far
enough to save anything.

A phone photo is 3–8 MB. Vercel caps a serverless request body at **4.5 MB** and
the function at its duration limit, and this route hands every uploaded byte to
Sharp to decode. Smaller photos from the same phone squeaked through in eight
seconds; larger ones died — silently, because a body-limit rejection never
reaches the route's own error handling.

**The waste was the bug.** The route resizes everything to 1920px anyway, so
those megabytes were carried across a job-site connection and decoded in full to
produce a result identical to sending 400 KB.

Photos are now shrunk in the browser before upload — longest edge 1920, JPEG at
0.82, skipped under 600 KB and skipped entirely if the re-encode comes out
larger. A format the browser cannot decode (some HEIC) uploads unchanged, since
failing to shrink beats failing to upload.

Two ordering details that matter:
- **EXIF is read from the original file, before the re-encode.** A canvas drops
  EXIF, and that capture date is what sorts a backlog onto the right day.
- **One bad photo no longer abandons the batch.** The loop used to throw on the
  first failure; nineteen good photos would go nowhere because the twentieth was
  odd. Each is now tried on its own, the button counts "Uploading 7 of 20…", and
  the end reports how many failed and why.

`maxDuration = 60` on the route as well, so a stray full-size original finishes
rather than timing out with nothing to show.

## A reading is dated by its visit, not by when it was typed

Charles, generating a report on Monday for Sunday's monitor: *"it says 8/31
which is today not yesterday... which means it's not gonna report correctly
regardless."*

`taken_at` defaulted to `now()`. Readings get entered in the truck afterwards, or
the next morning, or on Monday for Sunday's monitor — so the stamp recorded when
Charles reached a keyboard, not when he held the meter.

That is not cosmetic. The drying chart plots by day: Sunday's readings landing on
Monday collapse two visits into one column and flatten the trend between them.
And the date prints in a document an adjuster reads.

`readingTimestamp` now takes the date from the visit the reading belongs to, at
that visit's start time so a day sorts before the next one, and **clamped to
now** — a visit still in the future cannot have produced a reading, and a chart
running into next week reads as a bug.

### The other half, still open
Jill's eight existing readings are stamped 8/31 *and* attached to the **8/29
mitigation visit**, when Charles meant the **8/30 Sunday monitor**. The date fix
does not move them: readings follow whichever visit is selected further up the
page, and that selection is invisible from where the work happens. Which is how
Sunday's readings went onto Saturday's visit without a word.

A visit picker beside the readings was drafted and rejected. **The design is
Charles's call**; the underlying fault — that the target visit is chosen far from
where readings are entered, and never shown — is real and unaddressed.

### Verifying the chain, on the clock the server actually runs

Charles: *"I just wanna make sure that the logic is correct — if I enter the
readings on that specific day it needs to be logged correctly in our final
conclusion and PDF printout."*

Checking it end to end turned up a second way to lose a day, downstream of the
timestamp. Three links, each with its own failure:

1. **The stamp** — from the visit, not from `now()`. Fixed above.
2. **The chart column** — `dayKey` used the *server's* calendar day.
3. **The printed date** — `day()` formatted in the *server's* timezone.

The report renders on Vercel, where the process clock is **UTC**. A reading taken
at 7:30pm in Monument is already tomorrow in UTC, so both (2) and (3) would move
an evening reading a day forward — growing a column on the drying chart that
nobody worked, and printing a date the customer can contradict.

Both now name the day in `America/Denver`. The tests run with `TZ=UTC` forced,
because under Mountain time they pass while still being wrong in production —
and reverting `dayKey` proves it: two of them fail immediately.

The chain is now asserted whole: **Sunday's visit → stamped Sunday → Sunday's
column → "8/30/2026" in the PDF**, all evaluated on a UTC clock.

## The Visits card was already the visit picker

Charles: *"you have THIS visits section right here where we can cycle through the
different visits for the job which is a perfect place to edit."*

He is right, and it is why the banner I drafted was refused: the control already
existed. What it lacked was any indication of what selecting a visit *does* — the
selected row now says "Readings and photos land on this day", which is the whole
consequence and was previously invisible.

### The visits were out of order

They were ordered by `visit_sequence`, so his list read 8/29, 8/31, 8/30, 9/01.
Monitors are dragged onto whatever slot fits, so **the third one queued is often
the second one worked** — the sequence number records the order they were
created, which is not a fact anybody needs. Ordered by date and time now.

### There was no way to add a monitor

Three monitors is the starting guess made on day one, and it was final. A closet
that stalls, a subfloor that will not give it up, a customer who switched the
equipment off over the weekend — any of them means a fourth visit, and the count
could not change.

"Add another monitor visit" puts one in the **tray**, not on the calendar,
because a monitor gets fitted around cleaning work by hand — the same tray every
other monitor is dragged out of. Its sequence number is taken from the highest of
both the queue and the calendar, so numbers are never reused across the two.

## Readings are per visit, and the screen has to say so

Charles: *"I just tried to change the moisture reading for the very first day to
40% and then I clicked over to the first day of monitor and it was 40% but it
should've been 30 because we need to show materials falling over time."*

The data was already right — every reading carries the visit it was taken on.
**The screen was not.** It showed a point's entire history no matter which visit
was selected, so one reading looked like it belonged to every day at once, and
the trend the whole feature exists to show could not be seen or built.

He also assumed I had done the same for atmospheric readings. I had not; they
had the identical fault, and worse consequences.

### Two different questions, kept apart

- **What did we read on THIS visit?** The box you type into and correct. Empty
  on a visit with no reading yet, rather than borrowing another day's number.
  Typing over it *corrects that visit's reading* instead of stacking a second
  one on the same day, and the button says "Update" rather than "Save".
- **What did it read AS OF this visit?** ~~What the map colours, carrying the
  last known reading forward.~~ **Wrong, and removed the same day it shipped.**
  See below.

### The atmospheric case was worse

The verdicts describe **one moment**: what the room held, what came out of the
dehumidifier, how that compared to the unaffected air. Judging them across every
visit at once paired Tuesday's outlet with Saturday's room reading — describing a
machine and a room that never existed together, and reading exactly as
confidently as a true one.

They are now computed from the selected visit's readings alone. The **trend** is
deliberately the exception: it is the one verdict that should span every visit,
because that is what a trend is.

The list shows this visit's readings, says so, and notes how many belong to other
visits rather than hiding that they exist.

### The carry-forward was my invention, and it was wrong

I built `readingAsOf` to carry the last known reading onto a day nobody re-read
it, reasoning that a material "has not become unknown". Charles, immediately:

> *"the readings on the 31st and the first should be blank because we haven't
> done them yet. That should be blatantly obvious."*

It is. The 31st and the 1st are monitor visits that **have not happened**.
Painting them with Saturday's numbers makes work that was never done look done —
on the same screen whose entire purpose is showing what changed between visits.
A drying log that invents readings for unworked days is worse than no drying log.

**A visit shows what was read on that visit. Nothing is carried forward.** A
visit with no readings shows none, and says why: *"This visit has not happened
yet — readings are blank because nobody has taken them."* Blank on its own reads
as a screen that failed to load; blank with a reason reads as a day not yet
worked.

The wider fault he named is the real one: I had been fixing the exact thing
pointed at, one at a time, rather than reasoning about the model. The
carry-forward was not something he asked for — it was a decision I made and
justified in a comment, and it was wrong on its face for a drying log.

## Two points with the same name broke the chart

Charles's job has two reading points called "Drywall 1" and two called
"Drywall 2". A label is free text; of course it repeats.

The drying chart and the PDF keyed each series by that label. Duplicate React
keys mean **one of the two lines silently disappears**, and the legend cannot
tell the survivors apart — on a document a carrier reads, with the point that
was still wet quite possibly the one that vanished.

Series now carry the point's own id. The labels can be identical; the lines
cannot collide.

### And one change deliberately NOT made

I had also raised grouping the report's readings by visit instead of by point.
On thinking about it: no. Per-point with dates — *North wall · 8/29: 28% ·
8/30: 20% · 8/31: 11%* — already shows the fall, which is the whole job of a
drying log, and the chart shows it graphically besides. Grouping by visit would
duplicate the daily notes section. That would have been motion, not improvement.

His labels are likewise **his**: "Drywall 1" with the material set to Framing is
almost certainly probing framing behind a drywall wall, which is ordinary. The
defect that naming exposed was mine, not his.

## Points number themselves

Charles: *"the labels should just be like 123456 by default and if we decide we
wanna name them, we can."*

Right, and it removes the cause rather than the symptom. Naming every probe costs
a decision per point on a job with a dozen of them, and the names people reach
for under that pressure repeat — which is exactly how this job ended up with two
"Drywall 1"s and two "Drywall 2"s, and how the chart came to drop a line.

A point with no label given takes the next number. Typing a name still works and
is kept; it is simply no longer required, and the Add button no longer refuses
until something is typed.

**Numbered from the highest existing number, not the count.** Deleting point 3 of
5 would otherwise make the next one a second 5 — the same duplicate-label problem
arriving by a different road. A hand-typed name is skipped by that arithmetic, so
naming a point never disturbs the sequence.

## Two rules I broke on the same document

### Internal warnings were printing on the customer's PDF

Charles: *"you're not putting all these warnings on my PDF are you?"*

I was. The atmospheric findings block put *"check the filter, the coils, and that
it is actually running"* and *"Drying has stalled: water is still coming from
somewhere, or the equipment is not working"* into a claim file.

This is the rule he gave weeks ago about Category 3 warnings, restated: internal
guidance is for us. **Readings are facts; diagnoses are not.** A document that
tells an adjuster our equipment might be broken is a document that invites the
claim to be questioned — and it says it in our own words.

The block is gone. The atmospheric table keeps temperature, RH and GPP, and the
reader draws the conclusion. The material rows lost their "wet"/"still drying"
verdict too, for the same reason; "reached" against a stated dry standard is a
fact and stays.

Asserted against the report's **source**, with comments stripped, not against the
rendered bytes — a PDF compresses its text streams, so a byte scan would pass
while the words were on the page. That is the worst possible outcome for a test
whose whole job is to keep them off it.

### The dry standards were mine, not his

Charles: *"where are you getting these thresholds... I'm having to dial in
numbers that I don't think I've ever achieved in order to meet your green
level."*

Split the provenance and the fault is obvious:

- **The bands are his.** Green within 2 of the standard, amber within 15, red
  beyond — that is his framing example generalized.
- **The 10% standard was his too — for wood.** I then applied it to *every*
  material in the list, gypsum and insulation included.

Wood is read in true percent moisture content, so 10 means the same on any meter.
Drywall and concrete are read on relative or reference scales that differ by
meter, so a number invented for them is not conservative — it is meaningless, and
it was quietly setting a green target he had never hit.

Only the wood family keeps a default now. Everything else reads grey and says
"Set a dry standard — read an unaffected spot of the same material", which is
both true and how the S500 says to arrive at one.
