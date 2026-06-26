import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { getChargeableInvoice } from '@/lib/tech/appointments'
import {
  buildSquarePosUrl,
  detectMobilePlatform,
} from '@/lib/payments/square-pos'
import { createAdminClient } from '@/supabase/server'

/**
 * Build a Square Point of Sale deep link for this job's invoice total, so the
 * tech can hand the amount to the Square app and the customer can tap their
 * card. Returns { url } — the client opens it. Amount is computed server-side
 * (never trusted from the client). Works for any invoice: back-office roles can
 * charge anything; a tech is limited to their assigned jobs.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const supabase = createAdminClient()
    const { id } = await params

    const invoice = await getChargeableInvoice(supabase, {
      role: access.role,
      userId: access.staff?.id ?? access.id,
      appointmentId: id,
    })
    if (!invoice) {
      return NextResponse.json(
        { error: 'No chargeable invoice for this job' },
        { status: 404 },
      )
    }

    const applicationId = process.env.SQUARE_APPLICATION_ID
    if (!applicationId) {
      return NextResponse.json(
        { error: 'Square is not fully configured (missing Application ID).' },
        { status: 503 },
      )
    }

    // Where Square should send the user back to (the page they started on).
    // Only same-origin relative paths are honored.
    const body = (await request.json().catch(() => ({}))) as {
      returnTo?: string
    }
    const returnTo =
      typeof body.returnTo === 'string' &&
      body.returnTo.startsWith('/') &&
      !body.returnTo.startsWith('//')
        ? body.returnTo
        : `/tech/jobs/${id}`

    const cents = Math.round(invoice.total * 100)
    const origin = request.nextUrl.origin
    // Square matches this callback_url against the EXACT URL registered in the
    // Developer Console — no wildcards, no dynamic path, and no extra query
    // string. So the callback is the bare registered path, and the per-job data
    // (appointment id + where to return the tech) rides in Square's `state`
    // field, which Square round-trips back to us untouched.
    const callbackUrl = `${origin}/api/tech/square-pos-return`
    const state = JSON.stringify({ a: id, r: returnTo })
    const platform = detectMobilePlatform(request.headers.get('user-agent'))

    const url = buildSquarePosUrl({
      platform,
      amountCents: cents,
      callbackUrl,
      applicationId,
      locationId: process.env.SQUARE_LOCATION_ID,
      note: invoice.invoiceNumber
        ? `Invoice #${invoice.invoiceNumber}`
        : `Job ${id}`,
      state,
    })

    return NextResponse.json({ url, platform, amount: invoice.total })
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
