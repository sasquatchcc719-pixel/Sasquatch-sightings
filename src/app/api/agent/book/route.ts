import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { validateAgentRequest, checkRateLimit } from '@/lib/agent-auth'
import { createAiStyleBooking } from '@/lib/ops/create-ai-style-booking'
import { checkServiceArea } from '@/lib/service-area'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(request: NextRequest) {
  try {
    const auth = await validateAgentRequest(request)
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: CORS },
      )
    }

    const rl = checkRateLimit(auth.key.id, '/api/agent/book')
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error:
            'Rate limit exceeded. Booking is limited to 5 requests per minute.',
        },
        {
          status: 429,
          headers: {
            ...CORS,
            'Retry-After': String(Math.ceil((rl.retryAfterMs || 60000) / 1000)),
          },
        },
      )
    }

    const body = await request.json()
    const supabase = createAdminClient()

    const firstName = String(body.customer?.first_name || '').trim()
    const lastName = String(body.customer?.last_name || '').trim()
    const email = String(body.customer?.email || '').trim()
    const phone = normalizePhone(String(body.customer?.phone || '').trim())

    if (!firstName || !lastName || !email || !phone) {
      return NextResponse.json(
        {
          error:
            'customer.first_name, customer.last_name, customer.email, and customer.phone are all required',
        },
        { status: 400, headers: CORS },
      )
    }

    const street1 = String(body.address?.street_1 || '').trim()
    const city = String(body.address?.city || '').trim()
    const state = String(body.address?.state || 'CO').trim()
    const zipCode = String(body.address?.zip_code || '').trim()

    if (!street1 || !city || !zipCode) {
      return NextResponse.json(
        {
          error:
            'address.street_1, address.city, and address.zip_code are required',
        },
        { status: 400, headers: CORS },
      )
    }

    // Validate service area
    const serviceAreaCheck = checkServiceArea(zipCode)
    if (!serviceAreaCheck.allowed) {
      return NextResponse.json(
        { error: serviceAreaCheck.message },
        { status: 400, headers: CORS },
      )
    }

    const appointmentDate = String(body.date || '').trim()
    const startTime = String(body.start_time || '').trim()

    if (!appointmentDate || !startTime) {
      return NextResponse.json(
        { error: 'date (YYYY-MM-DD) and start_time (HH:MM) are required' },
        { status: 400, headers: CORS },
      )
    }

    const requestedItems: Array<{ service_id: string; quantity: number }> =
      Array.isArray(body.line_items) ? body.line_items : []

    if (requestedItems.length === 0) {
      return NextResponse.json(
        {
          error:
            'line_items array is required with at least one { service_id, quantity }',
        },
        { status: 400, headers: CORS },
      )
    }

    // AI agent bookings go direct (confirmed immediately) unless the key explicitly
    // overrides to request mode. Service-area approval is no longer forced.
    const effectiveBookingMode =
      auth.key.booking_mode === 'request' ? 'request' : 'direct'

    const result = await createAiStyleBooking({
      supabase,
      customer: {
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
      },
      address: {
        street_1: street1,
        city,
        state,
        zip_code: zipCode,
      },
      appointment_date: appointmentDate,
      start_time: startTime,
      line_items: requestedItems,
      booking_mode: effectiveBookingMode,
      booking_channel: 'ai_agent',
      source_label: auth.key.label,
      lead_source: `AI Agent (${auth.key.label})`,
      actor_label: `AI agent (${auth.key.label})`,
      admin_heading: 'AI Agent booking',
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: 400, headers: CORS },
      )
    }

    return NextResponse.json(
      {
        success: true,
        confirmation_number: result.confirmation_number,
        status:
          result.appointment_status === 'booked'
            ? 'confirmed'
            : 'pending_approval',
        appointment_date: result.appointment_date,
        start_time: result.start_time,
        end_time: result.end_time,
        subtotal: result.subtotal,
        discount_applied: result.discount_applied,
        total: result.total,
        message: result.message,
      },
      { headers: CORS },
    )
  } catch (err) {
    console.error('[agent/book] Error:', err)
    return NextResponse.json(
      {
        error:
          'Failed to create booking. Please have the customer call (719) 249-8791.',
      },
      { status: 500, headers: CORS },
    )
  }
}
