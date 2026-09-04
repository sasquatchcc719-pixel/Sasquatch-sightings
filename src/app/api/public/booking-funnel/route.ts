import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { isFunnelStep } from '@/lib/ops/booking-funnel'

/**
 * Fire-and-forget funnel tracking for the marketing-site booking widget.
 *
 * Records one row per (session, step) so back-navigation and repeat fires
 * don't inflate counts; the stored quote value keeps the highest seen for
 * that step. No PII and no IP address is stored — the session id is a random
 * client-generated string that lives in sessionStorage.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

/**
 * Flag every event in a session when the booking belongs to an internal
 * (staff/owner) customer.
 *
 * Best-effort by design: a failure here must never surface to the widget, and
 * an unflagged test session is a smaller problem than a booking that errors.
 */
async function markSessionIfInternal(
  supabase: ReturnType<typeof createAdminClient>,
  sessionId: string,
  appointmentId: string,
): Promise<void> {
  try {
    const { data: appt } = await supabase
      .from('ops_appointments')
      .select('customer_id')
      .eq('id', appointmentId)
      .maybeSingle()
    if (!appt?.customer_id) return

    const { data: customer } = await supabase
      .from('ops_customers')
      .select('is_internal')
      .eq('id', appt.customer_id)
      .maybeSingle()
    if (!customer?.is_internal) return

    await supabase
      .from('booking_funnel_events')
      .update({ is_test: true })
      .eq('session_id', sessionId)
  } catch (error) {
    console.error('[booking-funnel] internal-session check failed', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      session_id?: string
      step?: string
      quote_total?: number
      item_count?: number
      appointment_id?: string
      referrer?: string
      landing_path?: string
    }

    const sessionId = String(body.session_id || '')
      .trim()
      .slice(0, 64)
    const step = String(body.step || '').trim()

    if (!sessionId || !isFunnelStep(step)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid session_id or step' },
        { status: 400, headers: CORS },
      )
    }

    const quoteTotal = Math.max(0, Number(body.quote_total) || 0)
    const itemCount = Math.max(0, Math.floor(Number(body.item_count) || 0))
    const supabase = createAdminClient()

    // Keep the first-seen timestamp but let a later, larger quote win.
    const { data: existing } = await supabase
      .from('booking_funnel_events')
      .select('id, quote_total')
      .eq('session_id', sessionId)
      .eq('step', step)
      .maybeSingle()

    if (existing) {
      if (quoteTotal > Number(existing.quote_total || 0)) {
        await supabase
          .from('booking_funnel_events')
          .update({
            quote_total: quoteTotal,
            item_count: itemCount,
            updated_at: new Date().toISOString(),
            ...(body.appointment_id
              ? { appointment_id: body.appointment_id }
              : {}),
          })
          .eq('id', existing.id)
      }
      return NextResponse.json({ ok: true }, { headers: CORS })
    }

    await supabase.from('booking_funnel_events').insert({
      session_id: sessionId,
      step,
      quote_total: quoteTotal,
      item_count: itemCount,
      appointment_id: body.appointment_id || null,
      referrer: String(body.referrer || '').slice(0, 300) || null,
      landing_path: String(body.landing_path || '').slice(0, 300) || null,
    })

    // A completed booking is the first point at which we learn WHO the session
    // was. If it's an internal record — the owner testing the widget — retire
    // the whole session from reporting, not just this event: the visits and
    // quote steps leading up to it are equally fake.
    if (step === 'booked' && body.appointment_id) {
      await markSessionIfInternal(supabase, sessionId, body.appointment_id)
    }

    return NextResponse.json({ ok: true }, { headers: CORS })
  } catch (error) {
    // Never let tracking break the booking flow.
    console.error('[public/booking-funnel]', error)
    return NextResponse.json({ ok: false }, { status: 200, headers: CORS })
  }
}
