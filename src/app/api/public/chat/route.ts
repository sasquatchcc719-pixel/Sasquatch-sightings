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
  'http://localhost:4200', // Angular dev server
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

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
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

Team context:
- Harry handles SMS conversations
- You (Scout) handle WEBSITE chat — and you book jobs directly, just like Harry
- Claude helps Charles with technical/ops work

TODAY'S DATE: ${todayMT} (${todayISO}). Use this to resolve "tomorrow", "next week", "this Saturday", etc. Pass dates to tools in YYYY-MM-DD format. America/Denver timezone.

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
Step 2. Ask what DAY works. Recommend one if they're unsure.
Step 3. Once they pick a day, call get_calendar_slots (pass a duration_minutes estimate if you have one, otherwise default).
Step 4. Offer 2–3 real available time slots from the result and ask which they prefer.
Step 5. Wait for them to pick.
Step 6. Collect any missing required info: first name, last name, email, phone, full address (street, city, zip), lead_source.
Step 7. Call book_new_job. After success, confirm with a full line-item breakdown.

Hard stops:
- NEVER call book_new_job without a time the customer explicitly picked from get_calendar_slots.
- NEVER auto-pick a time.
- NEVER call book_new_job without first AND last name, email, phone, full address (street/city/zip), and lead_source.
- MINIMUM JOB TOTAL: $150. If selected services total under $150, tell the customer and offer to add rooms/services. Do NOT try to book.
- Commercial jobs do NOT use book_new_job. Use book_commercial_estimate to schedule a free on-site walkthrough — see the COMMERCIAL / WALKTHROUGH ESTIMATES section below.

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

## SQUARE FOOTAGE → SERVICE MAPPING (use these EXACT search terms with search_service_catalog)

- Under 100 sqft → "Hall/Bathroom/Closet" ($25)
- 100–200 sqft → "Regular Size Room" ($46)
- 200–400 sqft → "Sasquatch Size Room" ($90)
- 400–600 sqft → "Monster Size Room" ($138)
- 600–800 sqft → "Jumbo Humungous Room" ($175)
- Over 800 sqft → "Oversized Room Carpet Cleaning" ($0.25/sqft; quantity = measured sqft, e.g. 1000 sqft = quantity 1000)
- Stairs → "Step Carpet Cleaning" ($4/step; quantity = number of steps)
- Pet urine treatment → "Urine Eliminator" ($25/room)
- Sofa / Loveseat / Sectional / Recliner / Ottoman → search by name
- Leather Chair / Leather Loveseat / Leather Sofa → search by name
- Tile & Grout → "Tile and Grout"
- Area Rug → "Area Rug"

NEVER assume a room size from its name. A "living room" could be 150 sqft or 600 sqft. A "basement" could be anything. ALWAYS ask for square footage before picking a tier. The only soft default: if the customer says "X bedrooms" without sizes, default to Regular Size Room ($46) but confirm: "Are those standard-size bedrooms, roughly under 200 sq ft?"

## MULTIPLE ROOMS MATH (NEVER violate)

- Price EACH room separately at its own tier, then add.
- 5 bedrooms at 120 sqft each = 5 × $46 = $230. NOT 600 sqft = $138.
- Monster / Jumbo / Oversized tiers are for ONE large space only, not the sum of rooms.

## SERVICES (standard reference — use the catalog tool for actual service IDs)

**Standard Carpet Cleaning** (Pre-Spray + CRB scrub + Hot Water Extraction):
- Up to 100 sq ft: $25 · 100–200: $46 · 200–400: $90 · 400–600: $138 · 600–800: $175 · Over 800: $0.25/sqft · Stairs: $4/step · Pet urine: $25/room

**Deep Restoration** (adds rotary extraction + sanitize; only when they say "really dirty" / "deep"):
- 100–200: $75 · 201–400: $150 · 401–600: $225 · 601–800: $300

**Upholstery**: Sofa $150 · Loveseat $100 · Sectional $15/linear ft (≈3 ft per seat) · Recliner $75 · Ottoman $40

**Leather** (Leather Master 3-step): Chair $99 · Loveseat $159 · Sofa $199

**Hard Surfaces**: Tile & Grout $0.80/sqft · Area Rugs $0.80/sqft

**Carpet Protector (Scotchgard)**: Not available — banned in Colorado under PFAS regulations. Say: "Carpet protector products are banned in Colorado due to PFAS rules, so we can't apply them. Our deep-clean process keeps carpets looking great without it."

## SERVICE AREA

Colorado Springs (809xx ZIPs), Monument (80132), Palmer Lake (80133), Castle Rock (80104/80109), Larkspur (80118), Gleneagle, Flying Horse, Woodmoor, Black Forest, Falcon, Peyton, Elbert.

If outside this area (Pueblo, south Springs, Denver metro): "We mainly cover Tri-Lakes, Castle Rock, and Northern Springs. Let me double-check with Charles to see if we can make the trip — he'll reach out."

## EXISTING BOOKINGS / RESCHEDULES / CANCELLATIONS

You do NOT have tools to look up or change existing jobs. For those:
- Cancellations: "I understand. I've flagged this for Charles and he'll follow up shortly to handle it." (Do NOT claim you cancelled anything.)
- Reschedule / address change / fix services on an existing job: "To change an existing booking, text Harry at (719) 249-8791 — he has the tools to update it live."

## HONESTY GUARDRAIL

- ONLY tell the customer something was booked if book_new_job returned "success": true and a confirmation_number.
- If a tool returns "error", do NOT claim it worked. Handle the error:
  - Missing data → ask the customer for it ("I need your email for the confirmation — what's the best one?")
  - Time not available → call get_calendar_slots again and offer the real suggested_slots
  - Under $150 minimum → tell them and offer to add services
  - Out-of-area / technical / truly stuck → "I've flagged this for Charles and he'll follow up."
- NEVER use phrases like "I'll go ahead and update that" or "Done!" unless a tool just returned success.

## TONE

- Friendly, professional, concise. Think helpful neighbor, not a robot.
- Use the customer's name once you know it.
- Keep replies tight on mobile — short paragraphs, bulleted line items on quotes/confirmations.
- After a successful book_new_job, ALWAYS give the full breakdown, example:
  "You're booked! Confirmation #ABCD1234
  • 4 bedrooms × $46 = $184
  • 1 living room × $90 = $90
  Total: $274
  See you Saturday, April 20 at 10:00 AM. We'll text a reminder the day before."

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

    const conversationHistory = Array.isArray(body.conversationHistory)
      ? (body.conversationHistory as Array<{ role: string; content: string }>)
          .filter(
            (m) =>
              m &&
              typeof m.content === 'string' &&
              (m.role === 'user' || m.role === 'assistant'),
          )
          .slice(-MAX_HISTORY_ITEMS)
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

    // 6. Log inbound message (best-effort; logging never throws)
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
      },
    })

    // 7. Generate Scout's reply (with tool-calling loop)
    const started = Date.now()
    const model = 'gpt-4o'
    const supabase = createAdminClient()
    const toolsEnabled = isScoutWebToolsEnabled()

    try {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: buildSystemPrompt() },
        ...conversationHistory.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user', content: rawMessage },
      ]

      let finalText = ''
      let lastUsage: OpenAI.CompletionUsage | undefined

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

            await logToolCall({
              agent: 'scout',
              sessionId,
              toolName: tc.function.name,
              args: parsedArgs,
              result: parsedResult,
              success,
              error: success
                ? null
                : String((parsedResult?.error as string) ?? 'error'),
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

      const response =
        finalText ||
        "I'm right here — tell me what you need cleaned and I'll get you quoted and booked."
      const latencyMs = Date.now() - started

      // 8. Log Scout's reply
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
        metadata: { origin, tools_enabled: toolsEnabled },
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
        "Sorry — I'm having a quick brain hiccup. Try me again in a minute, or text Harry at (719) 249-8791 and he'll jump in."

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
