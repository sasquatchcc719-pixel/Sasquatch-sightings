import { NextRequest, NextResponse } from 'next/server'
import {
  bookingErrorDeviceLabel,
  bookingErrorStageLabel,
  markBookingErrorAlert,
  normalizeBookingErrorInput,
  recordBookingError,
} from '@/lib/ops/booking-errors'
import { sendBookingToolErrorAlert } from '@/lib/telegram'
import { createAdminClient } from '@/supabase/server'

const DEFAULT_ALLOWED_ORIGINS = [
  'https://sasquatchcarpet.com',
  'https://www.sasquatchcarpet.com',
  'http://localhost:4200',
  'http://localhost:3000',
]
const MAX_BODY_BYTES = 20_000
const ALERT_COOLDOWN_MS = 10 * 60 * 1000

function allowedOrigins(): string[] {
  const configured = process.env.SCOUT_ALLOWED_ORIGINS
  return configured
    ? configured
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  if (origin && allowedOrigins().includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin')
  const headers = corsHeaders(origin)
  return new NextResponse(null, {
    status: origin && allowedOrigins().includes(origin) ? 204 : 403,
    headers,
  })
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  const headers = corsHeaders(origin)
  if (!origin || !allowedOrigins().includes(origin)) {
    return NextResponse.json(
      { ok: false, error: 'Origin not permitted' },
      { status: 403, headers },
    )
  }

  try {
    const contentLength = Number(request.headers.get('content-length') || 0)
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { ok: false, error: 'Payload too large' },
        { status: 413, headers },
      )
    }

    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { ok: false, error: 'Payload too large' },
        { status: 413, headers },
      )
    }

    let body: Record<string, unknown>
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON' },
        { status: 400, headers },
      )
    }
    const input = normalizeBookingErrorInput(
      body,
      request.headers.get('user-agent'),
    )
    if (!input) {
      return NextResponse.json(
        { ok: false, error: 'Invalid booking error report' },
        { status: 400, headers },
      )
    }

    const supabase = createAdminClient()
    const recorded = await recordBookingError(supabase, input)
    let alerted = false

    if (recorded.shouldAlert) {
      const cooldownStart = new Date(
        Date.now() - ALERT_COOLDOWN_MS,
      ).toISOString()
      const { data: recentAlert } = await supabase
        .from('booking_error_events')
        .select('id')
        .eq('stage', input.stage)
        .gte('alert_sent_at', cooldownStart)
        .neq('id', recorded.event.id)
        .limit(1)
        .maybeSingle()

      if (!recentAlert) {
        alerted = await sendBookingToolErrorAlert({
          stageLabel: bookingErrorStageLabel(input.stage),
          errorMessage: input.errorMessage,
          httpStatus: input.httpStatus,
          sessionId: input.sessionId,
          quoteTotal: input.quoteTotal,
          itemCount: input.itemCount,
          appointmentDate: input.appointmentDate,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail,
          landingPath: input.landingPath,
          device: bookingErrorDeviceLabel(input.userAgent),
          occurrenceCount: recorded.event.occurrence_count,
        })
        await markBookingErrorAlert(supabase, recorded.event.id, alerted)
      }
    }

    return NextResponse.json({ ok: true, recorded: true, alerted }, { headers })
  } catch (error) {
    console.error('[public/booking-errors]', error)
    // Error reporting must never become another customer-facing booking error.
    return NextResponse.json(
      { ok: false, recorded: false },
      { status: 200, headers },
    )
  }
}
