# Push tab: ramble + Generate (like Jobs tab)

**Decision:** Everything in one place (no separate OneSignal dashboard). In-app Push tab with a **ramble-then-generate** flow like the jobs tab.

---

## Flow

1. **Ramble box** – Textarea where you type or paste whatever you want to say (rough notes, bullet points, ramble). No structure required.
2. **Generate button** – Calls `POST /api/admin/push/generate` with the ramble. AI returns a polished **title** and **body** for a push notification (short, clear, optional CTA). Same pattern as [src/app/api/generate-description/route.ts](src/app/api/generate-description/route.ts) and [src/components/admin/job-editor.tsx](src/components/admin/job-editor.tsx) (Generate Description with AI).
3. **Editable result** – Title and Body fields are filled; you can tweak before sending.
4. **Audience** – **Checkboxes** for each category so you can send in one action to everybody or pick specific groups:
   - **Admin** | **Business card** | **Vendor (all)** | **Contest** (and optionally "Vendor – [Partner]" for single-audience sends).
   - "Select all" option to tick every category and send once to all. No filling out separate content per group – same title/body for all selected.
5. **Send** – One click sends to all checked audiences. Backend sends **one notification per selected audience** (same content, different target) so we get **per-category delivery stats**.
6. **Results by category** – Dashboard shows results **per category** (e.g. a row or card per audience: Business card – Delivered 20, Opened 5; Contest – Delivered 15, Opened 3) so you can compare which channel is doing better.

---

## Implementation outline

| Piece | What |
|-------|------|
| **Admin page** | New route e.g. `src/app/admin/push/page.tsx` (or under a "Notifications" nav item). Ramble textarea, Generate button, Title/Body fields, Audience selector, Send button. |
| **Generate API** | `src/app/api/admin/push/generate/route.ts` – POST with `{ ramble }`, call OpenAI/Anthropic with system prompt "Turn this into a push notification: short title and body, keep intent and key details." Return `{ title, body }`. |
| **Send API** | `src/app/api/admin/push/send/route.ts` – POST with `{ title, body, audiences[] }` (array of selected categories). For each selected audience, send one OneSignal notification (same title/body). Store each result with `message_id` and `audience` so we have per-category stats. Return or poll View Message per id to get delivered/opened per audience. |
| **Subscriber acquisition** | Load OneSignal on `/tap`, `/links`, `/location/[partnerId]`, and contest page(s). On subscribe, set tags (source, partner_id when applicable). Reuse or extend [src/components/onesignal-init.tsx](src/components/onesignal-init.tsx) and add to root layout or these page layouts; add tag calls after subscription. |
| **Nav** | Add "Push" or "Notifications" to [src/components/admin-navigation.tsx](src/components/admin-navigation.tsx). |

---

## What we can collect and display (audience and delivery info)

### Before send: who will get it

- **OneSignal does not expose audience size via API** for segments or filters (no “how many people in Tap visitors”). The View Segments API returns segment names and metadata only, not subscriber counts.
- **What we can show:** Audience **label** only (e.g. “Admin only”, “Tap visitors”, “Vendor tap – [Partner name]”). Optionally, an **approximate count** by reusing the last send: when we send to “Tap visitors”, we save the delivery count (see below) and show e.g. “Tap visitors (~42 last send)” so you have a ballpark for the next send.

### After send: delivery stats (from OneSignal)

- When we send a notification, OneSignal’s **Create notification** response returns a message **id**. We can then call **View message** (`GET /notifications/{id}`) to get:
  - **successful** – number of notifications delivered to push/email/SMS servers  
  - **received** – confirmed deliveries (where the device confirmed receipt)  
  - **converted** – clicks (opens)  
  - **errored** – delivery errors  
  - **failed** – e.g. unsubscribed  
- **What we can show in the dashboard:**
  - **On the compose form:** After you hit Send, show a short summary: “Sent. Delivered to X people. Y opened.” (by fetching the message once after send, or from the create response if it includes counts).
  - **Recent sends list (optional):** Store each sent message id (and audience, title, timestamp) in our DB or in memory. On the Push page, list “Recent sends” and for each fetch View Message and show: title, audience, date, and delivery stats (delivered, opened, failed). OneSignal keeps message data for about 30 days for API-sent messages.

### Summary table

| Info | Source | Where to show |
|------|--------|----------------|
| Audience label | Our UI (Admin / Tap visitors / Vendor) | Dropdown, and “Sending to: Tap visitors” before Send |
| Approximate audience size | Last send’s “successful” count for that audience (we save it) | e.g. “Tap visitors (~42)” next to the option |
| Delivered count | View Message API after send | “Sent. Delivered to 42 people.” |
| Opened / clicked count | View Message API (`converted`) | “12 opened.” |
| Recent sends with stats | Store message id per send, then View Message for each | “Recent sends” list with title, date, delivered, opened |

### Implementation notes

- **Extend send API:** When we call OneSignal create notification, capture the returned `id`. Return it to the frontend and/or save it (e.g. in a `push_sends` table or in app state). Optionally call View Message once after a short delay and return `successful`, `received`, `converted` in the send response so the UI can show “Delivered to X, Y opened” without a separate request.
- **Optional “Recent sends”:** Store `{ messageId, audience, title, sentAt }` in the DB. On load, fetch the last 10; for each, call View Message (or a single batch if OneSignal supports it) and display a small table: Title | Audience | Date | Delivered | Opened.
- **Optional “audience size” hint:** When we send to “Tap visitors”, save the `successful` count keyed by audience (e.g. in DB or server cache). On next load, show “Tap visitors (~42)” using that saved value. Label it as approximate.

---

## History and performance over time

You want to see **how things do over time** – not just the latest send, but history and trends.

**Why we store it ourselves:** OneSignal only keeps message data for about 30 days for API-sent messages. To have long-term history we **persist every send in our DB** and save the stats when we fetch them from View Message.

**What we store (e.g. `push_sends` table):** `id`, `message_id` (OneSignal), `audience` (Admin / Business card / Vendor / Contest), `title`, `sent_at`, and stats from View Message: `delivered`, `received`, `opened`, `failed`, `errored`. After each send we fetch View Message and update the row so we keep history beyond 30 days.

**History UI on the Push page:**
- **History list:** Past sends – Date | Title | Category | Delivered | Opened (and optional open rate %). Filter by **date range** (e.g. last 7 / 30 / 90 days) and by **category** so you can see how a channel did over time.
- **Summary over time (optional):** Totals by category for the selected period (e.g. "Last 30 days – Business card: 120 delivered, 30 opened (25%); Contest: 80 delivered, 12 opened (15%)") or a simple trend (delivered/opened per week by category). All from the same `push_sends` data.

---

## Subscriber acquisition (same feature for all three)

We want the same push-notification experience for **business card** tappers, **vendor** (location) page visitors, and **contest** clicks. So we add the notification prompt and tagging on all of these entry points:

| Entry point | Tagging | Audience in Push tab |
|-------------|---------|----------------------|
| `/tap` | `source = tap` | "Business card" |
| `/links` | `source = tap` (or same as tap) | "Business card" (or combined with tap) |
| `/location/[partnerId]` | `source = vendor`, `partner_id = <id>` | "Vendor – All" or "Vendor – [Partner name]" (dropdown) |
| Contest flow (e.g. `/sightings` or `/location/[partnerId]/contest`) | `source = contest`, optional `partner_id` if per-location | "Contest" (and optionally per-partner) |

**Implementation:** OneSignal init + permission prompt on each page; on subscribe, set tags via OneSignal SDK (e.g. `OneSignal.User.addTagWithKey("source", "tap")` and for vendor/contest add `partner_id` when available). OneSignal must be loaded on these public pages (currently it only loads in admin layout).

---

## Prerequisites (from earlier plan)

- OneSignal loaded on public tap, links, location, and contest pages so visitors can subscribe and get tagged. Without that, the non-admin audiences will be empty until that work is done.
