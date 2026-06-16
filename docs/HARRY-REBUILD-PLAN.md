# Harry Rebuild Plan

**Date:** June 16, 2026
**Status:** Draft for Charles's approval — no code written yet
**Decision:** Shelve the current Harry (leave it running, untouched). Build a new agent from scratch on a proper framework, approval-gated, that earns trust one capability at a time.

---

## Why we're rebuilding instead of patching (again)

Harry has been patched ~50–60 times. Each patch adds another guard rule; the system gets more complex and, in practice, less reliable. The most recent attempt (Fable, June 9–12) was the same pattern — six commits that walked down a documented bug list adding guards. It was **not** the ground-up rebuild that was asked for, and the very next failure ($1,600 invoice) was a brand-new failure mode none of those patches touched.

The decisive evidence comes from the action ledger (June 8–16):

| Category | Tools | Calls | Correct |
|---|---|---|---|
| **Reads / lookups** | search_service_catalog, get_calendar_slots, list_appointments, report_problem | **37** | **37 (100%)** |
| **Writes / mutations** | reschedule, update_line_items, add_note, book_new_job | **9** | **0 (0%)** |

**Harry's reads are 100% reliable. Harry's writes are 0% reliable.** Every mutation in the logged window failed or produced garbage.

### The 9 mutation failures, root-caused

| Cluster | What happened | Whose fault |
|---|---|---|
| **A. Prerequisite not resolved** | `add_job_note` / `update_job_line_items` called with **no appointment_id** → hard fail (3 calls) | Architecture — the tool is callable without the thing it requires |
| **B. slot_token mismatch** | Model passed a valid token from `get_calendar_slots`; server rejected it; retried 4× in 17s (4 calls) | Glue/server bug — the model did the right thing |
| **C. service ref collapse** | `book_new_job` sent `service_id: ""`; the $1,600 job sent four refs that all resolved to one service (4 services searched, only the last survived in state) (2 calls) | Glue — the ref-resolution layer, plus no sanity check |
| **D. Says one thing, does another** | Tool returned `new_total: 1600`; 36 seconds later Harry told the customer the total was "under $150." It asserted a number it had no data for, contradicting its own tool result | Model narrating numbers it should never touch |

**None of these is the model being bad at language.** It understood every request. It failed at the *plumbing*: threading server-owned IDs/tokens/refs through a fragile, overwrite-prone state layer — and at being allowed to *state* numbers it never computed.

A key realization: **old Harry is a hand-built, buggy version of exactly what mature agent frameworks now ship as tested primitives** (durable state, resume/retry, human-in-the-loop gates). Rebuilding on a framework lets us *delete* the most bug-prone code we have rather than keep nursing it.

---

## The one rule everything serves

> Harry proposes an **action + a reply together**. The reply's words and numbers are generated **from the real action result** — never from the model's imagination. The owner approves them as one unit. The action executes and the reply sends only on approval, and only to the thread that texted in.

This single rule kills Clusters A–D by construction.

---

## Approval model — nothing happens without your tap in Telegram

**This is the backbone of the whole rebuild, not a feature.**

- **Every outbound message and every database change is gated behind your approval in Telegram.** In phase 1 the new Harry has *zero* authority to act on its own — it cannot send a text, edit a job, book, reschedule, or add a note without you approving it first. Nothing reaches a customer or the database unattended.
- Each proposal arrives as a **Telegram push** showing three things: the customer + which thread, the **exact action** it wants to take, and the **exact message** it wants to send.
- You can: **Approve** (the action runs *and* the matching message sends), **Reject** (nothing happens — silence to the customer, no change to data), or **edit** — reply in plain language to have it rewrite (re-approve), or type the exact words to send verbatim.
- The **recipient is always the thread that texted in.** You cannot accidentally approve a message to the wrong person; there is no path for the model to name or pick a recipient.
- **There is no global "auto" switch in phase 1.** Autonomy is earned per-capability, later, and only after that capability is clean across the eval set. The "Auto" mode does not exist until a specific intent proves it deserves one.

In short: until proven otherwise, Harry is a drafting assistant that asks your permission for every single thing — message *and* action — over Telegram.

---

## Decisions locked

- **Framework: Mastra.** TypeScript-native, runs on your existing Vercel, stores state in your existing Supabase Postgres, human-in-the-loop suspend/resume and evals are first-class. (LangGraph rejected: its managed runtime isn't Vercel-compatible and its TS edition trails Python — too much infra for a solo-maintained app.)
- **Cost: no new monthly bill.** Mastra core is free/open-source and self-hosted in infra you already pay for. Only ongoing cost is OpenAI tokens (pennies/month at your volume) + the Twilio SMS you already pay.
- **Model: step up to a stronger OpenAI model** for the agent's reasoning (exact current flagship confirmed at scaffold time; OpenAI-only per AGENTS.md). Cost is negligible at this volume; reliability is the point.
- **Approval-first, everything.** The new agent sends nothing and changes nothing on its own. Every action + message is approved by Charles. Autonomy is earned per-intent, only after that intent is clean in the eval set.
- **Channel: Telegram** (push notifications already work well).
- **Recipient bound to the inbound thread** — the model cannot choose or name a recipient.
- **New module beside the untouched old Harry.** Old Harry stays live so the business never goes dark. New agent takes over intent by intent; old Harry is retired only when fully replaced.
- **End goal: full parity** — everything today's Harry does, rebuilt, all behind approvals.

---

## Architecture

- **Model owns language only:** understand the text, classify intent, draft warm copy, emit a *structured intent*.
- **Deterministic, tested code owns everything that can hurt you:** resolving the appointment, reading current state, applying a **diff** (not rebuilding whole arrays), computing every price/total/duration, conflict checks, and choosing the recipient (always the inbound thread).
- **One approval = action + reply.** The Telegram message shows both the change and the customer-facing text; the numbers in the text come from the computed result.
- **Recipient inheritance:** a reply can only go to the number that texted in. There is no code path that turns a name into a recipient (this is what misrouted "Hi Marianne" to Alex).

### Reused from old Harry (deterministic, proven, no model in the loop)
Twilio send, Supabase clients, `service_catalog_items`, price/duration math.

### Left behind entirely (the accreted "brain")
`harry_workflow_states` state machine, `recovery.ts`, the response-guard regex layer, the `service_ref`/`slot_token`/`appointment_id` indirection, and the agent half of `sms-harry-tools.ts`. Mastra's suspend/resume + storage + evals replace these.

---

## Slice 1 — "Adjust a service + truthful reply" (the Jamie case)

**Flow:** inbound *"take the closet off"* → model proposes `{remove_service: closet}` → deterministic resolver loads the job, removes that one line, computes the **real** new total ($353) → builds the pending action **and** a reply whose numbers come from that real total → Telegram shows both → **Approve** runs the edit *and* sends the matching reply; **Reject** does nothing.

**Replay tests (each drawn from a real failure; written first, watched failing, then made to pass):**

| Test (from real failure) | Must hold |
|---|---|
| **Says = does** | Reply's claims match the action actually applied to the DB |
| **No blind numbers** (the "$150" lie) | Every figure in the reply is the computed total; the model cannot state one itself |
| **Recipient lock** (Marianne→Alex) | Sends only to the inbound thread's number, whatever the body says |
| **No write/send before approval** | Zero DB change and zero SMS until Approve is tapped |
| **Below-minimum honesty** (the $1,600) | If the change drops under the $150 minimum, Harry says so plainly and asks — never silently inflates quantities |

---

## Roadmap to parity (each behind the same approval gate)

Same machinery, one intent at a time. Each new capability = a structured intent + a deterministic resolver + its own replay tests added to the eval set.

1. **Slice 1** — adjust services on an existing job (above)
2. Reschedule a job
3. Add a job note (access/pets/parking, etc.)
4. Book a new job (LSA inbound → quote → booked) — the highest-value path
5. General Q&A / informational replies
6. (Later phase) Owner-side Telegram commands ("tell Marianne X") — rebuilt with recipient binding

A capability only graduates toward auto-send after it is clean across the eval set.

---

## Eval / replay set

Every real failure becomes a permanent regression test: the 9 ledger mutation failures, the Jamie "$150 / $1,600" case, and the Marianne→Alex misroute. The new agent must pass the relevant cases before any intent is trusted. This is the discipline that prevents "rebuild → new spaghetti in six months": correctness is enforced by runnable tests, not by anyone being careful in the moment.

---

## Honest caveats

- A framework removes **plumbing risk**, not **correctness risk.** Recipient binding, no-blind-numbers, intent→diff, and writing the replay cases are still ours to build and test.
- "Full parity in a day" is aggressive. The hard ~70% is the core machinery (approval flow, recipient binding, action↔reply coupling, eval harness). Once that's solid, each added intent is fast. Expect trustworthy slices landing *through* the day, not a big-bang at the end.
- Mastra is younger than LangGraph at extreme scale — irrelevant here; this is a low-volume local business where maintainability matters more than scale.
