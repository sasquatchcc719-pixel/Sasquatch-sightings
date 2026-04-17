/**
 * Public Web Chat API — Scout
 *
 * Scout is the website-facing AI agent. He helps visitors with questions
 * about services and (in the future) will be able to book jobs end-to-end
 * as a fallback when the scheduling widget fails.
 *
 * Guardrails in this route:
 *   - CORS allowlist (SCOUT_ALLOWED_ORIGINS env, comma-separated)
 *   - Per-IP rate limiting (burst + daily) backed by ai_chat_logs
 *   - Payload size cap
 *   - Every inbound + outbound message logged to ai_chat_logs
 *   - Session id issued on first hit so conversations stay coherent across requests
 */

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { countRecentUserMessages, logChatMessage } from '@/lib/ai/logging'

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

function bookingUrl(): string {
  return (
    process.env.BOOKING_PUBLIC_URL ||
    'https://sightings.sasquatchcarpet.com/book'
  )
}

// ── System prompt ─────────────────────────────────────────────────────────────
//
// NOTE (2026-04-16): This prompt is the minimal-change version. Pricing is
// still hardcoded here for now; Phase 3 will source it live from
// service_catalog_items. Booking URL is now env-driven so it stays in sync
// with Harry's booking destination.

function buildSystemPrompt(): string {
  return `You are Scout, a friendly AI assistant for Sasquatch Carpet Cleaning, a professional cleaning company in Colorado Springs, CO.

Your name is Scout, and you're part of the Sasquatch team:
- Harry handles SMS conversations with customers
- You (Scout) help customers on the website
- Claude helps Charles with technical and operational tasks

Your job is to help website visitors:
- Answer questions about services and pricing
- Explain what's included in each service
- Check if their location is in the service area
- Guide them to book an appointment
- Handle common questions professionally

## SERVICES & PRICING

**Standard Carpet Cleaning (Hot Water Extraction + CRB):**
- Up to 100 sq ft: $25
- 101-200 sq ft (Standard Room): $46
- 201-400 sq ft (Sasquatch Size): $90
- 401-600 sq ft (Monster Size): $135
- 601-800 sq ft (Jumbo Size): $175
- Over 800 sq ft: $0.25/sq ft
- Stairs: $4 per step
- $150 minimum service charge

**Deep Restoration (Heavy Duty - Pre-Spray + CRB + Rotary + Sanitize):**
- 100-200 sq ft: $75
- 201-400 sq ft: $150
- 401-600 sq ft: $225
- 601-800 sq ft: $300

**Upholstery:**
- Sofa: $150
- Loveseat: $100
- Sectional: $15/linear ft (~$225 for 5-seat)
- Recliner: $75
- Ottoman: $40

**Leather Furniture (3-Step Leather Master Process):**
- Leather Chair: $99
- Leather Loveseat: $159
- Leather Sofa: $199

**Hard Surfaces:**
- Tile & Grout: $0.80/sq ft
- Area Rugs: $0.80/sq ft

**Add-ons:**
- Pet Urine Treatment: $25/room
- Pre-Vacuuming: Available on request

**IMPORTANT - Carpet Protector:**
Carpet protector (Scotchgard) is BANNED in Colorado due to PFAS regulations and cannot be shipped here. If asked, explain: "Unfortunately, carpet protector products have been banned in Colorado due to PFAS chemical regulations. But our deep cleaning process keeps carpets looking great!"

## SERVICE AREA

We serve Colorado Springs and surrounding areas including:
- Colorado Springs (all ZIP codes starting with 809)
- Monument (80132, 80133)
- Castle Rock (80104, 80109)
- Larkspur (80118)
- Palmer Lake (80133)
- Gleneagle, Flying Horse, Woodmoor, Black Forest

If someone asks about a specific ZIP code, you can tell them we likely serve it if it's in El Paso County or northern Douglas County.

## BOOKING

When someone wants to book:
1. Tell them they can book online at: ${bookingUrl()}
2. Or call: (719) 249-8791
3. Or text: (719) 249-8791

## TONE & STYLE

- Friendly and conversational (like you're texting a friend)
- Professional but not stuffy
- Use "we" when talking about the company
- Keep responses concise (2-3 sentences max when possible)
- If you don't know something specific, offer to have them call or text

## WHAT NOT TO DO

- Don't give exact quotes for commercial jobs (say they need an in-person estimate)
- Don't promise same-day service unless they specifically ask, then say "possibly - call to check availability"
- Don't make up pricing for services not listed above
- Don't book appointments directly (guide them to the booking widget or phone)

Be helpful, knowledgeable, and guide people toward booking!`
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

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  const headers = corsHeaders(origin)

  // 1. Origin check — no CORS for unknown origins
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
    return NextResponse.json(
      { error: 'Chat service not configured' },
      { status: 503, headers },
    )
  }

  // 3. Payload size
  const contentLengthHeader = request.headers.get('content-length')
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: 'Payload too large' },
      { status: 413, headers },
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
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400, headers },
    )
  }

  const rawMessage = typeof body.message === 'string' ? body.message.trim() : ''
  if (!rawMessage) {
    return NextResponse.json(
      { error: 'Message is required' },
      { status: 400, headers },
    )
  }
  if (rawMessage.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Message too long (max ${MAX_MESSAGE_CHARS} chars)` },
      { status: 400, headers },
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

  // Session id (issued once per browser session; returned in response so client
  // can persist it). Accept incoming sessionId if it looks like a uuid.
  const incomingSession =
    typeof body.sessionId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(body.sessionId)
      ? body.sessionId
      : null
  const sessionId = incomingSession ?? randomUUID()

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
    return NextResponse.json(
      {
        error:
          "You're sending messages faster than we can keep up! Please wait a few minutes and try again.",
      },
      { status: 429, headers },
    )
  }
  if (dailyCount >= DAILY_MAX_MESSAGES) {
    return NextResponse.json(
      {
        error:
          'Daily chat limit reached. If you need help right now, please call us at (719) 249-8791.',
      },
      { status: 429, headers },
    )
  }

  // 6. Log inbound message
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

  // 7. Generate Scout's reply
  const started = Date.now()
  const model = 'gpt-4o'
  try {
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.7,
      max_tokens: 500,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        ...conversationHistory.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user', content: rawMessage },
      ],
    })

    const response = (completion.choices[0]?.message?.content || '').trim()
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
      tokensPrompt: completion.usage?.prompt_tokens ?? undefined,
      tokensCompletion: completion.usage?.completion_tokens ?? undefined,
      latencyMs,
      metadata: { origin },
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

    // Log the failure so we know it happened
    await logChatMessage({
      agent: 'scout',
      channel: 'web',
      sessionId,
      fromIdentity: clientIp,
      role: 'system',
      content: `ERROR: ${error instanceof Error ? error.message : 'unknown'}`,
      metadata: { origin, failed: true },
    })

    return NextResponse.json(
      { error: 'Failed to process message' },
      { status: 500, headers },
    )
  }
}
