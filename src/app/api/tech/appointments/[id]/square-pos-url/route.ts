import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  getAssignedTechAppointment,
  shouldHideTechPricing,
} from '@/lib/tech/appointments'
import {
  buildSquarePosUrl,
  detectMobilePlatform,
} from '@/lib/payments/square-pos'
import { createAdminClient } from '@/supabase/server'

/**
 * Build a Square Point of Sale deep link for this job's invoice total, so the
 * tech can hand the amount to the Square app and the customer can tap their
 * card. Returns { url } — the client opens it. Amount is computed server-side
 * (never trusted from the client). Square returns to the square-pos-return
 * route, which marks the invoice paid.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const { id } = await params
    const staffUserId = access.staff?.id ?? access.id
    const appointment = await getAssignedTechAppointment(
      supabase,
      staffUserId,
      id,
    )

    if (!appointment) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (appointment.hidePricing || !appointment.invoice) {
      return NextResponse.json(
        { error: 'Payment collection is unavailable for this job' },
        { status: 403 },
      )
    }

    const { data: current, error: currentError } = await supabase
      .from('ops_appointments')
      .select(
        `
          id,
          ops_recurring_templates (
            invoice_mode
          )
        `,
      )
      .eq('id', id)
      .eq('assigned_staff_user_id', staffUserId)
      .single()
    if (currentError) throw currentError
    if (shouldHideTechPricing(current)) {
      return NextResponse.json(
        { error: 'Payment collection is unavailable for this job' },
        { status: 403 },
      )
    }

    const applicationId = process.env.SQUARE_APPLICATION_ID
    if (!applicationId) {
      return NextResponse.json(
        { error: 'Square is not fully configured (missing Application ID).' },
        { status: 503 },
      )
    }

    const total = Number(appointment.invoice.total || 0)
    if (!Number.isFinite(total) || total <= 0) {
      return NextResponse.json(
        { error: 'Invoice total must be greater than zero' },
        { status: 422 },
      )
    }
    const cents = Math.round(total * 100)

    const origin = request.nextUrl.origin
    const callbackUrl = `${origin}/api/tech/appointments/${id}/square-pos-return`
    const platform = detectMobilePlatform(request.headers.get('user-agent'))

    const url = buildSquarePosUrl({
      platform,
      amountCents: cents,
      callbackUrl,
      applicationId,
      locationId: process.env.SQUARE_LOCATION_ID,
      note: appointment.invoice.invoiceNumber
        ? `Invoice #${appointment.invoice.invoiceNumber}`
        : `Job ${id}`,
      state: id,
    })

    return NextResponse.json({ url, platform, amount: total })
  } catch (error) {
    console.error('[tech/appointments/:id/square-pos-url][POST]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      {
        error:
          status === 401
            ? 'Unauthorized'
            : error instanceof Error
              ? error.message
              : 'Failed to start Square payment',
      },
      { status },
    )
  }
}
