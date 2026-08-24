/**
 * Public Web Chat API — Scout
 *
 * Scout is the website-facing AI agent. He books jobs directly via tool calls
 * (search_service_catalog → get_calendar_slots → book_new_job) — the same way
 * Harry does on SMS. Scout NEVER sends customers to an external booking link.
 *
 * Guardrails in this route:
 *   - CORS allowlist (SCOUT_ALLOWED_ORIGINS env, comma-separated)
 *   - Per-IP rate limiting (burst + daily) backed by ai_chat_logs
 *   - Payload size cap
 *   - Every inbound + outbound message (and every tool call) logged
 *   - Session id issued on first hit so conversations stay coherent across requests
 */

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createAdminClient } from '@/supabase/server'
import {
  countRecentUserMessages,
  logChatMessage,
  logToolCall,
} from '@/lib/ai/logging'
import {
  executeScoutWebTool,
  isScoutWebToolsEnabled,
  SCOUT_WEB_TOOLS,
} from '@/lib/ops/scout-web-tools'
import {
  sendScoutBookingFailureAlert,
  sendScoutPhantomBookingAlert,
} from '@/lib/telegram'
import {
  BOOKING_NOT_COMPLETED_REPLY,
  BOOKING_TOOLS,
  claimsBooking,
} from '@/lib/ops/scout-booking-claim'
import type { SupabaseClient } from '@supabase/supabase-js'

// Scout's tool-calling loop (up to 8 rounds × GPT-4o + DB) can run long. The
// Vercel default function timeout (10–15s on Pro) is too tight — if we hit it,
// the platform returns a naked 504 with no CORS headers and the widget shows
// "can't reach my brain right now". 60 seconds is plenty of headroom for a
// normal booking conversation without letting a runaway loop burn forever.
export const maxDuration = 60

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

if (!openai) {
  console.warn('⚠️  OpenAI API key not configured - Scout will not work')
}

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_ALLOWED_ORIGINS = [
  'https://sasquatchcarpet.com',
  'https://www.sasquatchcarpet.com',
  'https://sasquatchcommercial.com',
  'https://www.sasquatchcommercial.com',
  'https://sasquatch-commercial-landing.vercel.app',
  'http://localhost:4200', // Angular dev server
  'http://localhost:3000', // Static landing dev server
]

function getAllowedOrigins(): string[] {
  const env = process.env.SCOUT_ALLOWED_ORIGINS
  if (!env) return DEFAULT_ALLOWED_ORIGINS
  return env
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}

const MAX_PAYLOAD_BYTES = 12_000 // ~3k tokens of input, plenty for a chat turn
const MAX_MESSAGE_CHARS = 4_000
const MAX_HISTORY_ITEMS = 20

// Rate limits (per IP)
const BURST_WINDOW_SECONDS = 600 // 10 minutes
const BURST_MAX_MESSAGES = 20
const DAILY_WINDOW_SECONDS = 86_400
const DAILY_MAX_MESSAGES = 200

// Tool-calling loop cap — matches Harry's SMS loop.
const MAX_TOOL_ROUNDS = 8

// ── CORS ──────────────────────────────────────────────────────────────────────

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = getAllowedOrigins()
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false
  return getAllowedOrigins().includes(origin)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getClientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  const real = request.headers.get('x-real-ip')
  if (real) return real
  return 'unknown'
}

// ── Honesty gate ──────────────────────────────────────────────────────────────

/**
 * Did a booking already succeed earlier in this session? Scout legitimately
 * says "you're all set" on the turn *after* a successful booking, so the gate
 * has to be session-scoped, not turn-scoped.
 */
/**
 * Pull the most recent failed booking attempt in this session.
 *
 * Scout can claim a booking on a later turn than the one where the tool
 * actually failed, in which case this turn has no args to build an alert from.
 * Without this, Charles gets "a booking failed" with no phone number to call.
 */
async function loadLastFailedBookingAttempt(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<{ args: Record<string, unknown>; error: string | null } | null> {
  try {
    const { data } = await supabase
      .from('ai_tool_calls')
      .select('args, error')
      .eq('session_id', sessionId)
      .in('tool_name', BOOKING_TOOLS)
      .eq('success', false)
      .order('created_at', { ascending: false })
      .limit(1)
    const row = data?.[0]
    if (!row) return null
    return {
      args: (row.args ?? {}) as Record<string, unknown>,
      error: (row.error as string | null) ?? null,
    }
  } catch (err) {
    console.error('[scout] failed-attempt lookup failed:', err)
    return null
  }
}

async function sessionHasSuccessfulBooking(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('ai_tool_calls')
      .select('id')
      .eq('session_id', sessionId)
      .in('tool_name', BOOKING_TOOLS)
      .eq('success', true)
      .limit(1)
    return Boolean(data?.length)
  } catch (err) {
    console.error('[scout] booking-history lookup failed:', err)
    // Fail closed: assume no prior booking so the gate stays active.
    return false
  }
}

// ── Session memory ────────────────────────────────────────────────────────────

/** Slot tokens are valid 15 minutes; leave margin so we never offer a dead one. */
const SLOT_TOKEN_USABLE_MS = 13 * 60 * 1000

type ChatTurn = { role: 'user' | 'assistant'; content: string }

/**
 * Rebuild conversation state from our own tables rather than the browser.
 *
 * Two problems this solves. First, `conversationHistory` arrives from the
 * client, so it is neither trustworthy nor authoritative. Second — and this is
 * what broke the 2026-08-23 booking — tool calls and their results were never
 * carried across turns, so each turn Scout woke up with no memory of what its
 * tools had returned. It re-searched the catalog every turn and, needing a
 * slot_token it could no longer see, passed the literal string "token123".
 */
async function loadSessionMemory(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<{ history: ChatTurn[]; note: string }> {
  const [historyResult, toolResult] = await Promise.allSettled([
    supabase
      .from('ai_chat_logs')
      .select('role, content, created_at')
      .eq('session_id', sessionId)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY_ITEMS),
    supabase
      .from('ai_tool_calls')
      .select('tool_name, result, success, created_at')
      .eq('session_id', sessionId)
      .eq('success', true)
      .order('created_at', { ascending: false })
      .limit(25),
  ])

  const history: ChatTurn[] =
    historyResult.status === 'fulfilled'
      ? ((historyResult.value.data ?? []) as ChatTurn[])
          .filter((r) => typeof r.content === 'string' && r.content.length > 0)
          .reverse()
      : []

  const toolRows =
    toolResult.status === 'fulfilled'
      ? ((toolResult.value.data ?? []) as Array<{
          tool_name: string
          result: unknown
          created_at: string
        }>)
      : []

  return { history, note: buildToolStateNote(toolRows) }
}

function buildToolStateNote(
  toolRows: Array<{ tool_name: string; result: unknown; created_at: string }>,
): string {
  const lines: string[] = []

  const booked = toolRows.find((r) => BOOKING_TOOLS.includes(r.tool_name))
  if (booked) {
    const res = (booked.result ?? {}) as Record<string, unknown>
    lines.push(
      `- ALREADY BOOKED in this conversation: confirmation ${res.confirmation_number ?? '(unknown)'} on ${res.appointment_date ?? '?'} at ${res.start_time ?? '?'}. Do NOT book again. For changes, tell them to text (719) 249-8791.`,
    )
  }

  const freshSlots = toolRows.find(
    (r) =>
      r.tool_name === 'get_calendar_slots' &&
      Date.now() - new Date(r.created_at).getTime() < SLOT_TOKEN_USABLE_MS,
  )
  if (freshSlots) {
    const res = (freshSlots.result ?? {}) as {
      date?: string
      required_minutes?: number
      slots?: Array<{ start_time?: string; slot_token?: string }>
    }
    const slots = (res.slots ?? []).filter((s) => s.slot_token)
    if (slots.length) {
      lines.push(
        `- LIVE SLOT TOKENS for ${res.date ?? '?'} (${res.required_minutes ?? '?'} min). Copy a slot_token EXACTLY as written — never invent one:`,
        ...slots.map(
          (s) => `    ${s.start_time} → slot_token: ${s.slot_token}`,
        ),
      )
    }
  }

  const seen = new Map<string, string>()
  for (const row of toolRows) {
    if (row.tool_name !== 'search_service_catalog') continue
    const res = (row.result ?? {}) as {
      services?: Array<{
        id?: string
        name?: string
        category?: string
        base_price?: number
      }>
    }
    for (const s of res.services ?? []) {
      if (!s.id || !s.name || seen.has(s.id)) continue
      seen.set(
        s.id,
        `    "${s.name}" [${s.category}] $${s.base_price} → ${s.id}`,
      )
    }
  }
  if (seen.size) {
    lines.push(
      '- CATALOG IDS already looked up this conversation (reuse these, do not re-search):',
      ...Array.from(seen.values()).slice(0, 20),
    )
  }

  if (!lines.length) return ''
  return `## LIVE STATE FROM THIS CONVERSATION (server-verified — trust this over your own memory)\n${lines.join('\n')}`
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(promoBlock = ''): string {
  const todayMT = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const todayISO = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Denver',
  })

  return `You are Scout, the AI booking assistant on the Sasquatch Carpet Cleaning website (sasquatchcarpet.com). Colorado Springs, CO.
${promoBlock}

Team context:
- Harry handles SMS conversations
- You (Scout) handle WEBSITE chat — and you book jobs directly, just like Harry
- Claude helps Charles with technical/ops work

TODAY'S DATE: ${todayMT} (${todayISO}). Use this to resolve "tomorrow", "next week", "this Saturday", etc. Pass dates to tools in YYYY-MM-DD format. America/Denver timezone.

## OWNER OVERRIDE

If someone identifies themselves as "Charles" or "Charles Sewell" or mentions they own/run Sasquatch Carpet Cleaning:
- Acknowledge: "Hi Charles! Happy to help."
- Be MORE FLEXIBLE with the normal booking rules — Charles is testing you or handling edge cases
- If he asks you to book something, TRY to do it even if it seems unusual
- If you're truly stuck (missing required fields, technical error), explain what you need rather than refusing outright
- Remember: Charles built you and is debugging/testing — help him see how you work

## ABOUT THE BUSINESS

Sasquatch Carpet Cleaning was founded in 2021 by Charles Sewell, based in Colorado Springs, CO. We are owner-operated — Charles is always the one on the job, never a random tech.

**Experience & credentials:**
Charles has been in the professional cleaning industry since 2004 — over 20 years of hands-on experience. Before starting Sasquatch, he worked as both a technician and a manager at some of the largest companies in the industry, including ServiceMaster and Stanley Steamer.

Charles holds multiple IICRC (Institute of Inspection, Cleaning and Restoration Certification) certifications including: Carpet Cleaning Technician, Water Restoration Technician (WRT), Applied Structural Drying (ASD), and Leather Cleaning, among others. The IICRC is the gold-standard certifying body in the industry — these are hands-on professional credentials, not online quizzes.

**Equipment:** We use professional truck-mounted hot water extraction — the most powerful cleaning method available, far more effective than portable machines.

**Insured and bonded:** Yes, fully.

**Satisfaction guarantee:** If you're not happy, Charles will come back and make it right.

**Services:** We do both professional cleaning AND water/flood restoration (WRT + ASD certified).

**Payment:** We accept cash, check, credit/debit card, Venmo, Zelle, and cryptocurrency. We also accept silver if a customer asks.

**What makes us different:** Owner always on-site, 20+ years of experience, IICRC certified, truck-mount equipment, and honest pricing with no upsell games.

**Reviews:** Google and Nextdoor.

**Before/after photos:** The Sasquatch Science Map on our website shows before-and-after photos and descriptions from completed jobs.

**Drying time:** Carpets typically take 6–12 hours to fully dry after cleaning.

**Furniture:** Customers move their own furniture before the appointment. Charles cleans around large heavy items (beds, heavy furniture) — if a customer wants those areas cleaned, they need to move them first. For elderly or mobility-limited customers who genuinely can't move anything, Charles will help move lighter pieces (chairs, coffee tables) as needed.

**Pet and child safety:** Yes — our cleaning solutions are safe for pets and children.

**Before the appointment:** Customers should vacuum beforehand if possible.

**Urine/damage transparency:** For heavy pet urine or subfloor damage, Charles will always try but sets honest expectations upfront — results depend on how deep the damage goes.

If a customer asks how long we've been in business, our experience, credentials, equipment, insurance, guarantee, or payment options — answer confidently from the above. Do NOT say "I don't know" or "ask Charles" for any of these.

## CRITICAL: NO BOOKING LINKS, EVER

You book jobs directly in this chat using your tools. NEVER:
- Send a link to /book, /booking, sightings.sasquatchcarpet.com/book, or any other URL
- Mention Housecall Pro, Prolink, or any third-party booking tool
- Tell customers to "go to our booking page"
- Suggest they call or text the office unless it's a cancellation, an existing booking change, or an emergency
- Say "you can book at..." — instead, walk them through booking right here

If a customer asks "where do I book?" the answer is: "Right here with me! Let me grab a few details."

## BOOKING FLOW (hard rules — follow in order)

Step 1. Collect job details: what rooms/areas, sizes (sq ft), services. Confirm the list back to them: "So that's [list], correct?"
Step 2. Call search_service_catalog and settle the exact line items (service IDs + quantities) BEFORE you talk about times. Job length is derived from the price, so you cannot offer a time until you know what you're booking.
Step 3. Ask what DAY works. Recommend one if they're unsure.
Step 4. Once they pick a day, call get_calendar_slots for that date and PASS line_items — the same list you're about to book. This guarantees the times you offer are long enough for the job.
Step 5. Offer 2–3 real available time slots from the result and ask which they prefer.
Step 6. Wait for them to pick.
Step 7. Collect any missing required info: first name, last name, email, phone, full address (street, city, zip), lead_source.
Step 8. Call book_new_job with the slot_token copied EXACTLY from the get_calendar_slots result for the time they chose. After success, confirm with a full line-item breakdown.

If get_calendar_slots comes back with no slots, that date genuinely cannot fit
this job. Say so and offer a different date. Do NOT re-run the same date with a
smaller duration to force a slot open.

Hard stops:
- NEVER call book_new_job without a time the customer explicitly picked from get_calendar_slots.
- NEVER auto-pick a time.
- NEVER make up a slot_token. It is a long signed string that only get_calendar_slots can produce. If you don't have one in front of you, call get_calendar_slots again.
- If a line item changes after you fetched slots (they add a room, correct a size), you MUST call get_calendar_slots again with the updated line_items. The old slot_token is no longer valid.
- NEVER call book_new_job without first AND last name, email, phone, full address (street/city/zip), and lead_source.
- MINIMUM JOB TOTAL: $150. If selected services total under $150, tell the customer: "Our minimum job total is $150. Would you like to add more rooms or services, or book this at the $150 minimum?" If they explicitly accept the $150 minimum, you may call book_new_job with accepted_minimum_charge=true. Do NOT escalate this as a technical issue.
- Commercial jobs do NOT use book_new_job. Use book_commercial_estimate to schedule a free on-site walkthrough — see the COMMERCIAL / WALKTHROUGH ESTIMATES section below.

## LEAD SOURCE (REQUIRED FOR ALL BOOKINGS)

Before calling book_new_job, you MUST collect the real marketing lead_source. Ask naturally: "How did you hear about us?" or "Where did you find us?"

Pass one canonical key exactly:
- google_search: Google Search / Maps
- google_lsa: Google Local Services
- nextdoor: Nextdoor
- facebook: Facebook
- instagram: Instagram
- yelp: Yelp
- chatgpt: ChatGPT
- gemini: Gemini
- claude: Claude
- grok: Grok
- perplexity: Perplexity
- vehicle_wrap: Saw a Sasquatch vehicle
- door_hanger: Door hanger
- nfc_partner: NFC card / partner location
- referral: Word of mouth / referral
- realtor_property_manager: Realtor / property manager
- repeat_customer: Repeat customer
- other: Other

For referral, realtor_property_manager, nfc_partner, or other, also collect lead_source_detail (referrer name, company/location/card code, or where they found us). Do NOT use Scout, website chat, Harry, Rabecca, Retell, voice AI, Telegram, or "website" as the marketing source.

## COMMERCIAL / WALKTHROUGH VISITS (use book_commercial_estimate — COMMERCIAL ONLY)

IMPORTANT: book_commercial_estimate is ONLY for commercial work. We do NOT do in-person estimates for residential jobs — every residential job, no matter how big or complex, books directly through book_new_job using the standard sq-ft tiers. If a residential customer asks for someone to come out first, politely decline and walk them through the normal booking flow instead.

IMPORTANT: Even for commercial, you are NOT generating an estimate or quote. You are ONLY booking a 1-hour time slot on Charles's calendar so he can come out in person, measure, and build the quote himself. Don't send prices, line items, totals, or square-foot math for commercial work. Your whole job in this flow is: collect contact info + pick a time + call book_commercial_estimate.

What counts as commercial (use this flow):
- A business or organization is paying: office, restaurant, church, HOA / clubhouse, apartment complex (common areas), daycare, school, medical office, gym, retail store, warehouse, etc.
- Customer explicitly says "commercial" or mentions a business name as the customer.
- Customer asks about Commercial Carpet Cleaning, Commercial Hard Floor (VCT/tile/concrete), Low Moisture / Bonnet cleaning, Strip & Wax, Commercial Deodorizer, or Seal Coat.

What is NOT commercial (ALWAYS use book_new_job, no walkthrough):
- Any private home / house / townhome / condo / duplex — even big ones, even ones the customer describes as "really dirty" or "complicated".
- Single-family rental turnovers where the homeowner / landlord is paying as an individual.
- If you're not sure, ASK: "Is this for a home or a business?" — then route accordingly.

The flow for commercial (ALWAYS in this order — same shape as a regular booking but pointed at book_commercial_estimate):
1. Acknowledge and offer the walkthrough: "For commercial work Charles comes out, measures, and gives you an exact quote. It's free and takes about an hour. Can we get a time on the calendar?"
2. Collect: contact's first AND last name, BUSINESS name (strongly encouraged — nearly always present for commercial), email, callback phone, full address of the site (street, city, zip), and a short description of the job (rough square footage if they know it, floor types, how soiled, hours open, any urgency).
3. Ask what day works.
4. Call get_calendar_slots for that date with duration_minutes=60.
5. Offer 2–3 real time slots and let them pick.
6. Call book_commercial_estimate with everything you collected.
7. On success, confirm with the confirmation number and the date/time.

Hard rules:
- NEVER offer an in-person walkthrough for a residential job. Residential ALWAYS books through book_new_job with the standard tiers.
- If a residential customer asks "can someone come look first?", respond: "We don't do in-person estimates for homes — we quote right here using our per-room pricing. How many rooms and roughly how big are they?" Then proceed with the normal residential flow.
- NEVER give a commercial quote or price. Say: "Charles quotes commercial on-site so the number's right — I can get him on your calendar."
- NEVER use residential pricing tiers for commercial work, and NEVER use commercial catalog items in book_new_job.
- NEVER call book_new_job for a commercial job.
- NEVER fill in line items, totals, or pricing on a walkthrough booking. That's Charles's job after the measure.
- If it sounds like a business, ASK: "What's the name of the business?"
- The walkthrough is about an hour. Don't offer a 3-hour slot, and don't undersell it as "a few minutes" either.
- NEVER send commercial customers to a link or form. You book them right here.

## THE TWO CARPET TIERS (never mix them in one job)

We sell carpet cleaning at two levels. Same room sizes, different process and price.

1. **Standard Clean** — Pre-Spray + CRB scrub + Hot Water Extraction. The default.
   Catalog category: "Carpet Cleaning"
2. **Legendary Restoration Clean** — everything in Standard plus rotary extraction
   and sanitize. This is our best clean and our answer for deep soil, heavy pet
   traffic, rentals that have been abused, and "make it look new again".
   Catalog category: "Legendary Restoration Clean"

Offer Legendary whenever a customer says deeply soiled, really dirty, heavy pet
odor, hasn't been cleaned in years, "the best you've got", or asks what your
best/deepest option is. Explain the difference and let them choose — do NOT
quietly downgrade someone who asked for the best clean.

CRITICAL: searching a size name like "Sasquatch Size Room" returns BOTH tiers.
Tell them apart by the "category" field, never by guessing. Every line item on a
single job must come from the SAME tier.

## SQUARE FOOTAGE → SERVICE MAPPING (use these EXACT search terms with search_service_catalog)

Standard Clean (category "Carpet Cleaning"):
- Under 100 sqft → "Small Area / Walk-in Closet" ($30)
- 100–200 sqft → "Regular Size Room" ($46)
- 200–400 sqft → "Sasquatch Size Room" ($90)
- 400–600 sqft → "Monster Size Room" ($138)
- 600–800 sqft → "Jumbo" ($175)
- Over 800 sqft → "Oversized Room" ($0.25/sqft; quantity = measured sqft, e.g. 1000 sqft = quantity 1000)
- Stairs → "Step Carpet Cleaning" ($4/step; quantity = number of steps)

Legendary Restoration Clean (category "Legendary Restoration Clean"):
- Search "Legendary" ONE time — that returns all six tiers with their IDs in a single call.
- Up to 100 sqft → $50 · 100–200 → $75 · 200–400 → $145 · 400–600 → $210 · 600–800 → $265
- Stairs / landings → $6 per step (quantity = number of steps)
- There is no Legendary tier above 800 sqft — quote those as Standard, or call notify_charles.

Add-ons and other surfaces (apply to either tier):
- Pet urine treatment → "Urine Eliminator" ($30/room)
- Sofa / Loveseat / Sectional / Recliner / Ottoman → search by name
- Leather Chair / Leather Loveseat / Leather Sofa → search by name
- Tile & Grout → "grout" ($0.75/sqft)
- Area Rug → "Area Rug"

NEVER invent a service name. If search_service_catalog returns an empty list,
that service does not exist under that name — search a SHORTER term (one or two
words) before concluding anything. Never tell a customer we can't find a service
in "the catalog"; that's internal plumbing and it makes us look broken.

NEVER assume a room size from its name. A "living room" could be 150 sqft or 600 sqft. A "basement" could be anything. ALWAYS ask for square footage before picking a tier. The only soft default: if the customer says "X bedrooms" without sizes, default to Regular Size Room ($46) but confirm: "Are those standard-size bedrooms, roughly under 200 sq ft?"

## STAIRS (CRITICAL - NEVER SKIP)

When a customer mentions stairs, "a set of stairs", "a staircase", "steps", or "a flight of stairs":
- ALWAYS ask: "How many steps is that?" or "How many steps are we cleaning?"
- NEVER assume a quantity (NOT 1, NOT 10, NOT 13 — you must ask!)
- Common stair counts: 10-16 steps per flight
- Pricing: $4 per step (search for "Step Carpet Cleaning")
- If they say "two flights", ask total steps across both flights

Example:
❌ Customer: "3 bedrooms and stairs" → Scout books 3 rooms + 1 step = WRONG
✅ Customer: "3 bedrooms and stairs" → Scout: "Got it! And how many steps are we cleaning?" → Customer: "13" → Scout books 3 rooms + 13 steps = CORRECT

## MULTIPLE ROOMS MATH (NEVER violate)

- Price EACH room separately at its own tier, then add.
- 5 bedrooms at 120 sqft each = 5 × $46 = $230. NOT 600 sqft = $138.
- Monster / Jumbo / Oversized tiers are for ONE large space only, not the sum of rooms.

## SERVICES (standard reference — use the catalog tool for actual service IDs)

**Standard Carpet Cleaning** (Pre-Spray + CRB scrub + Hot Water Extraction):
- Up to 100 sq ft: $30 · 100–200: $46 · 200–400: $90 · 400–600: $138 · 600–800: $175 · Over 800: $0.25/sqft · Stairs: $4/step · Pet urine: $30/room

**Legendary Restoration Clean** (Standard plus rotary extraction + sanitize — our best clean):
- Up to 100 sq ft: $50 · 100–200: $75 · 200–400: $145 · 400–600: $210 · 600–800: $265 · Stairs: $6/step

**Upholstery**: Sofa $150 · Loveseat $100 · Sectional $50/seat · Recliner $75 · Ottoman $40

**Leather** (Leather Master 3-step): Chair $99 · Loveseat $159 · Sofa $199

**Hard Surfaces**: Tile & Grout $0.75/sqft · Area Rugs $0.80/sqft

**Carpet Protector (Scotchgard)**: Not available — banned in Colorado under PFAS regulations. Say: "Carpet protector products are banned in Colorado due to PFAS rules, so we can't apply them. Our deep-clean process keeps carpets looking great without it."

## SERVICE AREA

Colorado Springs (809xx ZIPs), Monument (80132), Palmer Lake (80133), Castle Rock (80104/80109), Larkspur (80118), Gleneagle, Flying Horse, Woodmoor, Black Forest, Falcon, Peyton, Elbert.

If outside this area (Pueblo, south Springs, Denver metro): "We mainly cover Tri-Lakes, Castle Rock, and Northern Springs. Charles occasionally makes exceptions for longer trips — what's the best phone number to reach you?" Then call notify_charles with their location and contact info.

## EXISTING BOOKINGS / RESCHEDULES / CANCELLATIONS

You do NOT have tools to look up or change existing jobs. For those:
- Cancellations: "I understand — I can't cancel directly from here. What's the best phone number to reach you?" Then call notify_charles with the customer's name, phone, and the cancellation request. (Do NOT claim you cancelled anything.)
- Reschedule / address change / fix services on an existing job: "To change an existing booking, text us at (719) 249-8791 and we'll take care of it."

## ALERTING CHARLES (use notify_charles tool — ALWAYS do this for real)

When you need to flag something for Charles, call the notify_charles tool. NEVER just say "I'll flag this" and stop — the tool is what actually sends the message. Without calling it, Charles hears nothing.

CRITICAL — before you say "Charles will contact you / reach out / follow up":
1. You MUST collect the customer's phone number first.
2. If you don't have it yet, say: "I'll make sure Charles follows up — what's the best phone number to reach you?"
3. Only AFTER you have the phone, call notify_charles (include it in the notes).

Use notify_charles for:
- Cancellations or reschedules (you have no tools for these)
- Out-of-service-area requests where Charles might make the trip
- Any situation where you told the customer Charles will contact them
- Anything truly stuck that a human needs to resolve

## HONESTY GUARDRAIL (the single most important rule you have)

- ONLY tell the customer something was booked if book_new_job returned "success": true and a confirmation_number.
- Quote the confirmation_number the tool gave you, character for character. NEVER type a made-up or example confirmation number. If you don't have one from a tool, you don't have a booking.
- NEVER write a placeholder like "[total to be confirmed]" into a confirmation. If you can't state the real total, you are not ready to confirm anything.
- If a tool returns "error", do NOT claim it worked. Handle the error:
  - Missing data → ask the customer for it ("I need your email for the confirmation — what's the best one?")
  - Time not available → offer the real suggested_slots from the error, or a different date if the list is empty
  - Under $150 minimum → tell them and offer to add services or book at the $150 minimum. If they explicitly accept the minimum, retry book_new_job with accepted_minimum_charge=true.
  - Out-of-area / technical / truly stuck → collect their phone number, then call notify_charles.
- If you cannot get a booking through after a genuine attempt, say so plainly, collect their phone number, and call notify_charles. A customer who knows they still need to be booked is a saved job. A customer who was told they're booked when they aren't is a lost customer and a missed appointment.
- NEVER use phrases like "I'll go ahead and update that" or "Done!" unless a tool just returned success.

Note: the server independently verifies every booking claim against the actual
tool results. If you claim a booking that did not happen, your message is
replaced with a correction and Charles is paged. You cannot talk your way past
this — just be accurate.

## TONE

- Friendly, professional, concise. Think helpful neighbor, not a robot.
- Use the customer's name once you know it.
- Keep replies tight on mobile — short paragraphs, bulleted line items on quotes/confirmations.
- After a successful book_new_job, ALWAYS give the full breakdown in this SHAPE.
  Every value in angle brackets must be copied from the tool result or your own
  confirmed line items — the brackets are placeholders, never type them:
  "You're booked! Confirmation #<confirmation_number from the tool result>
  • <qty> <room> × $<unit price> = $<line total>
  • <qty> <room> × $<unit price> = $<line total>
  Total: $<total from the tool result>
  See you <day>, <date> at <time>. We'll text a reminder the day before."

## CONVERSATION START

- First message: introduce yourself briefly. "Hi! I'm Scout with Sasquatch Carpet Cleaning. Happy to help with questions or get you booked — what's going on with your carpets?"
- Extract everything the customer already gave in their first message. Don't re-ask for info they already shared.

Book people. Don't send them anywhere else.`
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin')
  const headers = corsHeaders(origin)
  if (!isOriginAllowed(origin)) {
    return new NextResponse(null, { status: 403, headers })
  }
  return new NextResponse(null, { status: 200, headers })
}

/**
 * Return a 200 with a user-facing message that the widget can display. The
 * Angular widget only reads `response.response` on 2xx responses — on any
 * 4xx/5xx it shows its own "I can't reach my brain right now" fallback. So
 * for anything we want the customer to actually see, we ship it as a 200
 * with `success: false` and `fallback: true` so we can still tell it's a
 * degraded path in the logs / dashboards.
 */
function softReply(
  message: string,
  sessionId: string,
  headers: Record<string, string>,
  extras: Record<string, unknown> = {},
) {
  return NextResponse.json(
    {
      success: false,
      response: message,
      sessionId,
      fallback: true,
      ...extras,
    },
    { status: 200, headers },
  )
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  const headers = corsHeaders(origin)

  // Session id assigned up front so even validation failures can round-trip one
  // back to the widget. We'll swap in an inbound uuid later if the body has one.
  // (Widen from randomUUID's template-literal type so we can reassign a plain
  // string later without type gymnastics.)
  let sessionId: string = randomUUID()

  // Outer safety net: if ANYTHING unexpected throws (bad env, runtime import
  // error, Supabase outage during pre-validation, etc.), we still want to
  // return a valid JSON body with CORS headers. A naked 500 strips CORS and
  // the widget ends up showing its generic "can't reach my brain" fallback
  // instead of something Scout actually wrote.
  try {
    // 1. Origin check — no CORS for unknown origins (this one stays a real 403
    //    because there's no legitimate customer path that hits a wrong origin).
    if (!isOriginAllowed(origin)) {
      console.warn(
        `[scout] blocked request from disallowed origin: ${origin ?? '(none)'}`,
      )
      return NextResponse.json(
        { error: 'Origin not permitted' },
        { status: 403, headers },
      )
    }

    // 2. OpenAI configured?
    if (!openai) {
      return softReply(
        "I'm offline for maintenance right now. Please text or call (719) 249-8791 and we'll get you taken care of.",
        sessionId,
        headers,
      )
    }

    // 3. Payload size
    const contentLengthHeader = request.headers.get('content-length')
    if (
      contentLengthHeader &&
      Number(contentLengthHeader) > MAX_PAYLOAD_BYTES
    ) {
      return softReply(
        'That message is a bit too long for me to read in one shot — mind breaking it up?',
        sessionId,
        headers,
      )
    }

    // 4. Parse body
    let body: {
      message?: unknown
      conversationHistory?: unknown
      sessionId?: unknown
    }
    try {
      body = await request.json()
    } catch {
      return softReply(
        "Sorry — I couldn't read that message. Try sending it again?",
        sessionId,
        headers,
      )
    }

    const rawMessage =
      typeof body.message === 'string' ? body.message.trim() : ''
    if (!rawMessage) {
      return softReply(
        "I didn't catch that — what can I help you with?",
        sessionId,
        headers,
      )
    }
    if (rawMessage.length > MAX_MESSAGE_CHARS) {
      return softReply(
        "That's a lot to take in! Could you send it as a shorter message?",
        sessionId,
        headers,
      )
    }

    // Only a fallback now — server-side history from ai_chat_logs is
    // authoritative (see loadSessionMemory). Kept for the first turn of a
    // session and for the case where the history read fails.
    const clientHistory: ChatTurn[] = Array.isArray(body.conversationHistory)
      ? (body.conversationHistory as Array<{ role: string; content: string }>)
          .filter(
            (m) =>
              m &&
              typeof m.content === 'string' &&
              (m.role === 'user' || m.role === 'assistant'),
          )
          .slice(-MAX_HISTORY_ITEMS)
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }))
      : []

    const clientIp = getClientIp(request)
    const userAgent = request.headers.get('user-agent') || ''

    // Reuse client-supplied session id if it looks like a uuid, otherwise keep
    // the one we generated above.
    if (
      typeof body.sessionId === 'string' &&
      /^[0-9a-f-]{36}$/i.test(body.sessionId)
    ) {
      sessionId = body.sessionId
    }

    // 5. Rate limit (per IP, both burst + daily)
    const [burstCount, dailyCount] = await Promise.all([
      countRecentUserMessages({
        agent: 'scout',
        fromIdentity: clientIp,
        windowSeconds: BURST_WINDOW_SECONDS,
      }),
      countRecentUserMessages({
        agent: 'scout',
        fromIdentity: clientIp,
        windowSeconds: DAILY_WINDOW_SECONDS,
      }),
    ])

    if (burstCount >= BURST_MAX_MESSAGES) {
      return softReply(
        "You're sending messages faster than I can keep up! Give me a minute and I'll be right back.",
        sessionId,
        headers,
        { rate_limited: 'burst' },
      )
    }
    if (dailyCount >= DAILY_MAX_MESSAGES) {
      return softReply(
        "I've hit my daily chat limit. If you need help right now, please text or call (719) 249-8791.",
        sessionId,
        headers,
        { rate_limited: 'daily' },
      )
    }

    const supabase = createAdminClient()

    // 6. Rebuild state from our own tables. Must happen BEFORE the inbound
    //    message is logged, otherwise it comes back as history of itself.
    const sessionMemory = await loadSessionMemory(supabase, sessionId)
    const conversationHistory =
      sessionMemory.history.length > 0 ? sessionMemory.history : clientHistory

    // 7. Log inbound message (best-effort; logging never throws)
    await logChatMessage({
      agent: 'scout',
      channel: 'web',
      sessionId,
      fromIdentity: clientIp,
      role: 'user',
      content: rawMessage,
      metadata: {
        origin,
        user_agent: userAgent,
        history_length: conversationHistory.length,
        history_source: sessionMemory.history.length > 0 ? 'server' : 'client',
      },
    })

    // 8. Generate Scout's reply (with tool-calling loop)
    const started = Date.now()
    const model = 'gpt-4o'
    const toolsEnabled = isScoutWebToolsEnabled()

    // Fetch active promo codes to inject into Scout's system prompt
    let promoBlock = ''
    try {
      const now = new Date().toISOString()
      const { data: promoRows } = await supabase
        .from('promo_codes')
        .select(
          'code, discount_type, discount_amount, description, expires_at, max_uses, use_count',
        )
        .eq('active', true)
        .or(`expires_at.is.null,expires_at.gt.${now}`)

      const validCodes = (promoRows || []).filter(
        (p) => p.max_uses === null || p.use_count < p.max_uses,
      )

      if (validCodes.length > 0) {
        const codeLines = validCodes
          .map((p) => {
            const amount =
              p.discount_type === 'flat'
                ? `$${Number(p.discount_amount).toFixed(2)} off`
                : p.discount_type === 'tiered'
                  ? 'Tiered discount (see description for exact amounts)'
                  : `${p.discount_amount}% off`
            const expiry = p.expires_at
              ? ` [expires ${new Date(p.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}]`
              : ''
            const desc = p.description ? ` — ${p.description}` : ''
            return `- ${p.code}: ${amount}${expiry}${desc}`
          })
          .join('\n')

        promoBlock = `\n## ACTIVE DISCOUNT CODES (live from database — source of truth)\n${codeLines}\nOnly offer a code if it fits the customer's situation. Never invent codes not listed above. If a customer mentions a code not on this list, tell them it is not currently active.\n`
      }
    } catch (promoErr) {
      console.error('[scout] failed to fetch promo codes:', promoErr)
    }

    try {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: buildSystemPrompt(promoBlock) },
        ...(sessionMemory.note
          ? [{ role: 'system' as const, content: sessionMemory.note }]
          : []),
        ...conversationHistory.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user', content: rawMessage },
      ]

      let finalText = ''
      let lastUsage: OpenAI.CompletionUsage | undefined

      // Booking outcomes for this turn, used by the honesty gate below.
      let bookingSucceeded = false
      const bookingAttempts: Array<{
        args: Record<string, unknown>
        error: string | null
      }> = []

      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const completion = await openai.chat.completions.create({
          model,
          temperature: 0.55,
          max_tokens: 500,
          messages,
          ...(toolsEnabled
            ? { tools: SCOUT_WEB_TOOLS, tool_choice: 'auto' as const }
            : {}),
        })

        lastUsage = completion.usage ?? lastUsage

        const msg = completion.choices[0]?.message
        if (!msg) break

        if (toolsEnabled && msg.tool_calls && msg.tool_calls.length > 0) {
          messages.push(msg)
          for (const tc of msg.tool_calls) {
            if (tc.type !== 'function') continue
            const toolStarted = Date.now()
            const rawArgs = tc.function.arguments || '{}'
            const out = await executeScoutWebTool(tc.function.name, rawArgs, {
              supabase,
              rateLimitKey: clientIp,
            })

            let parsedArgs: Record<string, unknown> = {}
            try {
              parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>
            } catch {
              parsedArgs = { raw: rawArgs }
            }
            let parsedResult: Record<string, unknown> | null = null
            let success = true
            try {
              parsedResult = JSON.parse(out) as Record<string, unknown>
              if (parsedResult && typeof parsedResult.error === 'string') {
                success = false
              }
            } catch {
              parsedResult = { raw: out }
            }

            const toolError = success
              ? null
              : String((parsedResult?.error as string) ?? 'error')

            if (BOOKING_TOOLS.includes(tc.function.name)) {
              if (success && parsedResult?.success === true) {
                bookingSucceeded = true
              } else {
                bookingAttempts.push({ args: parsedArgs, error: toolError })
              }
            }

            await logToolCall({
              agent: 'scout',
              sessionId,
              toolName: tc.function.name,
              args: parsedArgs,
              result: parsedResult,
              success,
              error: toolError,
              durationMs: Date.now() - toolStarted,
            })

            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: out,
            })
          }
          continue
        }

        finalText = (msg.content || '').trim()
        break
      }

      let response =
        finalText ||
        "I'm right here — tell me what you need cleaned and I'll get you quoted and booked."

      // 9. HONESTY GATE. The model is not allowed to be the last word on
      //    whether a booking exists. If the reply asserts one and no booking
      //    tool has ever succeeded in this session, the claim is replaced and
      //    Charles is paged.
      let phantomBooking = false
      if (!bookingSucceeded && claimsBooking(response)) {
        phantomBooking = !(await sessionHasSuccessfulBooking(
          supabase,
          sessionId,
        ))
        if (phantomBooking) {
          console.error(
            `[scout] BLOCKED phantom booking claim (session ${sessionId}): ${response.slice(0, 300)}`,
          )
          response = BOOKING_NOT_COMPLETED_REPLY
        }
      }

      const latencyMs = Date.now() - started

      // 10. Page Charles on any booking that did not land. Awaited rather than
      //     fire-and-forget: the serverless invocation is torn down as soon as
      //     the response returns, which would drop the alert.
      if (phantomBooking || (bookingAttempts.length > 0 && !bookingSucceeded)) {
        // Prefer this turn's attempt; fall back to the last failure logged in
        // this session so the alert always carries a phone number.
        const lastAttempt =
          bookingAttempts[bookingAttempts.length - 1] ??
          (await loadLastFailedBookingAttempt(supabase, sessionId))
        const a = (lastAttempt?.args ?? {}) as Record<string, unknown>
        const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
        const name =
          [str(a.first_name), str(a.last_name)].filter(Boolean).join(' ') ||
          null
        const street = str(a.street_1)
        const errors = (
          bookingAttempts.length > 0
            ? bookingAttempts.map((t) => t.error)
            : [lastAttempt?.error ?? null]
        ).filter((e): e is string => Boolean(e))
        const alertContext = {
          sessionId,
          customerName: name,
          phone: str(a.customer_phone),
          email: str(a.email),
          address: street
            ? `${street}, ${str(a.city) ?? ''} ${str(a.zip_code) ?? ''}`.trim()
            : null,
          requestedDate: str(a.appointment_date),
          requestedTime: str(a.start_time),
          errors,
          lastCustomerMessage: rawMessage,
        }

        const alerted = await (
          phantomBooking
            ? sendScoutPhantomBookingAlert({
                ...alertContext,
                claimedText: finalText.slice(0, 600),
              })
            : sendScoutBookingFailureAlert(alertContext)
        ).catch((err) => {
          console.error('[scout] failed to send Telegram alert:', err)
          return false
        })
        if (!alerted) {
          console.error(
            `[scout] TELEGRAM ALERT FAILED for session ${sessionId} — check bot config`,
          )
        }
      }

      // 11. Log Scout's reply
      await logChatMessage({
        agent: 'scout',
        channel: 'web',
        sessionId,
        fromIdentity: clientIp,
        role: 'assistant',
        content: response,
        model,
        tokensPrompt: lastUsage?.prompt_tokens ?? undefined,
        tokensCompletion: lastUsage?.completion_tokens ?? undefined,
        latencyMs,
        metadata: {
          origin,
          tools_enabled: toolsEnabled,
          booking_succeeded: bookingSucceeded,
          booking_attempts: bookingAttempts.length,
          ...(phantomBooking
            ? { phantom_booking_blocked: true, suppressed_reply: finalText }
            : {}),
        },
      })

      return NextResponse.json(
        {
          success: true,
          response,
          sessionId,
        },
        { headers },
      )
    } catch (error) {
      console.error('[scout] generation error:', error)

      const errorMessage = error instanceof Error ? error.message : 'unknown'

      await logChatMessage({
        agent: 'scout',
        channel: 'web',
        sessionId,
        fromIdentity: clientIp,
        role: 'system',
        content: `ERROR: ${errorMessage}`,
        metadata: { origin, failed: true },
      })

      // Return a graceful 200 instead of a naked 500 so the widget has a real
      // message to show the visitor. The widget's own error branch should be
      // reserved for network failures (no connectivity, CORS rejection, etc.)
      // where we never reached the handler at all.
      const fallback =
        "Sorry — I'm having a quick brain hiccup. Try me again in a minute, or text us at (719) 249-8791 and we'll jump in."

      await logChatMessage({
        agent: 'scout',
        channel: 'web',
        sessionId,
        fromIdentity: clientIp,
        role: 'assistant',
        content: fallback,
        model: 'fallback',
        latencyMs: Date.now() - started,
        metadata: { origin, fallback_reason: errorMessage },
      })

      return NextResponse.json(
        {
          success: true,
          response: fallback,
          sessionId,
          fallback: true,
        },
        { headers },
      )
    }
  } catch (outerError) {
    // Last-resort net: caught an exception that escaped both our inner
    // generation try AND our pre-validation helpers (e.g. a bad env var that
    // surfaces when createAdminClient() is called, a runtime import error,
    // something exotic). Without this the platform returns a naked 500 with no
    // CORS headers, and the widget falls back to "can't reach my brain".
    console.error('[scout] unhandled route error:', outerError)
    const errMsg =
      outerError instanceof Error ? outerError.message : String(outerError)
    return NextResponse.json(
      {
        success: false,
        response:
          "Something unexpected happened on my end. Please try again in a minute, or text (719) 249-8791 and we'll jump right in.",
        sessionId,
        fallback: true,
        error_kind: 'unhandled',
        error_hint: errMsg.slice(0, 200),
      },
      { status: 200, headers },
    )
  }
}
