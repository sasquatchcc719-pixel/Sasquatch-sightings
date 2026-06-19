# Phase 4 — AI teardown plan: remove Harry + George + Rabecca (June 2026)

Detailed, reviewable removal plan. **Nothing here has been executed** — this is for Charles to approve first. Companion to `HARRY-TEARDOWN.md` (status index).

## Scope

**REMOVE (abandoned agents):**
- **Harry** — SMS agent (`harry-next/`, the `openai-chat` SMS brain + tools), HarryCommandbot, Harry admin control UI.
- **George** — admin "Henderson" copilot (`/api/admin/george`, dashboard, `george/` lib, DB tables).
- **Rabecca / Retell** — voice agent live code (already inert, env-gated off).

**KEEP (working, valued):**
- **Scout** — website chat. Runs its OWN engine (`ops/scout-web-tools.ts` + direct OpenAI). Does **not** import `openai-chat.ts`. Untouched.
- **Analyst / Radar** — SEO + maps-ranking engine (`/api/analyst/*`, `/admin/analyst`). Actively valued. Must survive — see seam #4.
- **Ranger** — hiring bot (separate bot + webhook). Untouched.
- **Telegram relay** (Phase 2), Twilio call routing, all shared booking/ops plumbing, and the booking **channel labels/enums** (`retell_rabecca`, lead-source `rabecca`/`retell` patterns) — these are data labels, not agent wiring. KEEP.

**HARD REQUIREMENT (Charles):** leave the admin AI dashboard **clean** — zero nav links, toggles, cards, or capability docs pointing at a removed agent. A half-removed switchboard is worse than leaving it.

---

## The seams (why this is surgical, not a folder delete)

1. **`src/lib/harry/features.ts` is misnamed** — it's George **and** Analyst feature flags, not Harry. KEEP the file; delete only `isGeorgeFeatureEnabled` + `getGeorgeRolloutMode`. KEEP `isAnalystFeatureEnabled` + `isAnalystHistoryReadonlyEnabled` (5 analyst importers). *(Optional later: rename file to `lib/feature-flags.ts`.)*
2. **`src/lib/harry/control.ts` is shared** — holds Harry control-settings machinery **and** booking-link helpers (`getHarryWebsiteBookingUrl`, `getHarryOpsBookingUrl`, `getHarryActiveBookingUrl`, `containsKnownBookingLink`, `rewriteBookingLinks`) used by **call-after-hours + voicemail** (KEEP). After Harry SMS is cut, the control-settings snapshot/seed functions are likely orphaned — trim them, KEEP the booking-link helpers.
3. **`src/lib/openai-chat.ts` is Harry-only** — Scout is independent, so this whole cluster is deletable: `openai-chat.ts`, `ops/sms-harry-tools.ts`, `harry/workflow.ts`, `harry/recovery.ts`, `harry/minimum-disclaimer.ts`, `harry/recipient-safety.ts`, `harry/replay-cases.ts` (+ their tests).
4. **Analyst depends on Harry's control endpoint** — `src/app/admin/analyst/page.tsx:58` and `analyst/targets/page.tsx:143` `fetch('/api/admin/harry/control')` to read `analyst_enabled`, and link to `/admin/harry/control` (`page.tsx:274`, `targets/page.tsx:269`). **Disentangle before deleting** the Harry control route/page: add a tiny `/api/admin/analyst/status` (env read via `isAnalystFeatureEnabled`) and repoint those 2 fetches + 2 links.
5. **`create-ai-style-booking.ts`** `booking_channel: 'retell_rabecca'` enum + discount/lead-source logic, and `lead-sources.ts` `/rabecca/i`,`/retell/i` self-attribution patterns = **labels used by all AI booking paths**. KEEP.
6. **`RETELL_FUNCTION_SECRET`** is a fallback secret in `ops/slot-token.ts:38` (signs booking slot tokens). **Do not remove that env var until `SLOT_TOKEN_SECRET` is confirmed set in prod** (else booking links break).

---

## Pre-flight
- **Bookmark:** `git tag harry-archive-2026-06` at the current commit (recover anything via the tag). Per Charles: tag-then-delete, no `/_archive/` folder.
- **Drop** the uncommitted harry-command staleness-TTL fix (moot — that bot is going away): `git checkout -- src/app/api/telegram/harry-command/route.ts src/lib/harry/command-guards.test.ts` and revert its `sms-incoming` reorder.
- **DB tables stay** (`harry_control_settings`, `harry_logic_profiles`, `harry_knowledge_blocks`, `harry_next_pending_actions`, `george_*`, retell logs) — stop writing; don't drop. Dropping is the only irreversible step; do it later/never. *(Decision D4.)*

---

## Execution — ordered so the tree compiles & tests stay green at every stage

### Stage A — Harry runtime wiring (make Harry inert in code, delete Harry-only top layer)
1. **`sms-incoming/route.ts` surgery** (the delicate one): remove the harry-next dynamic-import block, the `notifyNewCustomerMessage` import+call, `recordHarryAssistantMessage` (`harry/workflow`), the `generateAIResponse` (`openai-chat`) auto-reply section, the hold/escalation logic, and now-unused `harry/control` imports. **KEEP:** Twilio parse, blacklist, Nextdoor intercept, source-typing + LSA promotion, **the relay forward**, the email + LSA notifications, conversation logging.
   - Verify: simulated inbound (fictitious number) still creates a relay topic + card, still emails, **sends no auto-reply**; relay test green.
2. Delete `src/app/api/telegram/harry-command/route.ts` and `src/app/api/admin/conversations/[id]/harry-draft/route.ts`.
3. Delete the Harry-only cluster: `src/lib/harry-next/` (whole dir), `src/lib/openai-chat.ts`, `src/lib/ops/sms-harry-tools.ts`, `src/lib/harry/{workflow,recovery,minimum-disclaimer,recipient-safety,replay-cases}.ts` + tests.
4. Delete `src/lib/harry-command-bot.ts` (no importers remain after 1–3; ops notifications already moved to the notification bot in `6f02a12`).
5. **Telegram:** `deleteWebhook` on `HARRY_COMMAND_BOT_TOKEN`; Vercel env remove `HARRY_NEXT_ENABLED` (already gone), `HARRY_NEXT_MODEL`, `HARRY_COMMAND_BOT_TOKEN`, `HARRY_COMMAND_ALLOWED_TELEGRAM_USER_IDS`, `HARRY_COMMAND_TELEGRAM_SECRET_TOKEN`, `HARRY_SMS_BOOKING_MODE`, `HARRY_SMS_OPS_TOOLS`. **KEEP** `HARRY_ANALYST_*` (Analyst).
   - Verify after A: `pnpm type-check`, `pnpm test:ci`, deploy, simulate inbound SMS round-trip, confirm relay + notifications intact.

### Stage B — Analyst disentangle (must precede Harry-control deletion)
1. Add `GET /api/admin/analyst/status` → `{ analystEnabled, historyReadonly }` from `isAnalystFeatureEnabled()`.
2. Repoint `analyst/page.tsx` + `analyst/targets/page.tsx`: fetch the new endpoint; replace the two `/admin/harry/control` links with `/admin/analyst` (or a plain "enable via env" note).
   - Verify: `/admin/analyst` + `/admin/analyst/targets` load and gate correctly with Harry control gone.

### Stage C — George
1. Delete `src/lib/george/`, `src/app/api/admin/george/`, `src/app/admin/harry/george/`, `src/components/admin/george-henderson-dashboard.tsx`.
2. `harry/features.ts`: remove `isGeorgeFeatureEnabled` + `getGeorgeRolloutMode` (+ `GeorgeRolloutMode` type). KEEP analyst exports.
3. Vercel env remove `GEORGE_HENDERSON_ENABLED`, `GEORGE_HENDERSON_ROLLOUT_MODE`.
   - Verify: type-check; Analyst routes still resolve `features.ts`.

### Stage D — Harry admin control surface
1. Delete `src/app/admin/harry/control/page.tsx`, `src/components/admin/harry-control-dashboard.tsx`, `src/app/api/admin/harry/{control,knowledge,profiles}/route.ts`.
2. Trim `src/lib/harry/control.ts` to the booking-link helpers still used by call-after-hours/voicemail; drop the now-orphaned control-settings snapshot/seed exports (verify no remaining importers first).

### Stage E — Rabecca / Retell *(Decision D2)*
1. Delete (recommended): `src/lib/retell/`, `src/app/api/retell/`, `src/app/api/twilio/rabecca-fallback/route.ts`, `src/app/admin/rabecca/`, `src/app/api/admin/rabecca/`, `scripts/retell-bridge.mjs`, and dead `rabeccaSipUri` in `call-routing-config.ts`.
2. **KEEP** the `retell_rabecca` booking-channel enum + `lead-sources` patterns + their tests (seam #5).
3. Env: remove `RETELL_API_KEY`, `REBECCA_VOICE_ENABLED`, `REBECCA_RETELL_SIP_URI`. **Hold `RETELL_FUNCTION_SECRET`** until `SLOT_TOKEN_SECRET` confirmed set (seam #6) — then remove.

### Stage F — Dashboard hygiene (the "no broken switches" pass)
- **Nav — `admin-navigation.tsx`:** remove "Control" (`/admin/harry/control`) and "George Henderson" (`/admin/harry/george`); remove "Rabecca Voice" if Stage E removes Rabecca. KEEP Ranger, "AI Chats" (Scout logs), Capabilities.
- **Nav — `mobile-header.tsx`:** same removals; fix the "Harry & George abilities" Capabilities description.
- **`ai-capabilities-reference.tsx`:** delete the George section (~lines 112–159); update the title/intro ("Harry and George" → Harry, or retitle); decide whether Harry stays as historical doc *(Decision D3)*.
- Final sweep: `grep -rn "/admin/harry/control\|/admin/harry/george\|admin/george\|harry-control-dashboard\|george-henderson"` over `src/` returns nothing.

### Stage G — Final verification
- `pnpm type-check` + `pnpm test:ci` clean; build succeeds.
- Click every remaining AI nav entry in admin → no 404s, no dead toggles.
- Live: inbound SMS → relay topic + card, reply → SMS from same number; a review-request/new-review/GSC alert still lands on the notification bot; `/admin/analyst` works; Scout still answers on the site.
- Deploy; spot-check prod logs.

---

## Decisions (Charles, answered — executing)
- **D1 — Everything in one pass.** A→F as a single change + one deploy/verify; Rabecca (E) included, not deferred.
- **D2 — Remove Rabecca fully** — voice code + nav + logs UI. Keep the `retell_rabecca` booking label and `RETELL_FUNCTION_SECRET` (slot tokens).
- **D3 — Delete the AI Capabilities page** + its nav link.
- **D4 — Drop the dead tables** in a final migration (last step, irreversible). Only tables confirmed orphaned (`harry_*`, `george_*`, retell logs) — never shared (`conversations`, `sms_logs`, `ops_*`, `phone_settings`, `radar_*`). Verify each has no remaining reader before dropping; the `harry/control.ts` booking-link helpers that call-routing keeps must not read a dropped table.
