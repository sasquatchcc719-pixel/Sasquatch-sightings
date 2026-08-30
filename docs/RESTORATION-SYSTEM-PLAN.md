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

### NOT DONE — no UI was built this pass
Everything below is schema-and-logic only. There is still no restoration screen.
1. Restoration button on the calendar; `/admin/operations/restoration/[id]` route
2. Loss intake form UI
3. Project close action ("dry standard reached") — the endpoint that assembles the
   invoice, credits the deposit, cancels remaining queued visits, and records revenue
4. Deposit collection UI (Square Tap to Pay writing to `ops_payments`)
5. Unscheduled tray + drag / tap-to-place
6. Component extraction from `appointment-detail.tsx` / `invoice-detail.tsx`
7. Map drawing, equipment placement UI, reading entry UI
8. Photo phase/room tagging UI and EXIF bulk backfill
9. Voice -> line items
10. Final report

### BLOCKED
- **53 enabled catalog items have no QuickBooks item.** They cannot be invoiced until
  those are created. The QuickBooks MCP connector is not authorized in this session, so
  they could not be created here. Needs either connector auth or a code path using the
  app's own QuickBooks OAuth integration (`src/app/api/admin/quickbooks/*`).

### Still unresolved (asked, not yet answered)
1. Saturday emergency call — after hours ($295.92) or business hours ($197.29)?
2. Jill's actual affected sq ft and flood-cut linear ft.
3. Offline/no-signal behavior for voice capture.
4. The two non-reconciling prices: 4ft flood cut $8.33 vs DRYW4 $6.50; Equipment Setup
   $92.65 vs EQ $70.69/HR.
5. **NEW — equipment day counting.** Current rule is elapsed 24-hour periods with a
   one-hour grace (Mon 9am -> Thu 9am = 3 days). Confirm this matches how Charles counts
   days today, since he has been doing it in his head.
