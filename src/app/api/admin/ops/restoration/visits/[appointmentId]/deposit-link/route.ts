import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { createSquarePosContext } from '@/lib/payments/square-pos-verification'
import {
  buildSquarePosUrl,
  detectMobilePlatform,
} from '@/lib/payments/square-pos'

/**
 * Deep link into Square Point of Sale to take the mitigation-day deposit.
 *
 * The existing tech charge route cannot be reused: it requires a chargeable
 * invoice, and a restoration deposit is collected days before any invoice
 * exists. A signed state and unique provider note bind the verified payment
 * to the visit when Square returns.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const { appointmentId } = await params
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))

    const amountCents = Math.round(Number(body.amount_cents))
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      return NextResponse.json(
        { error: 'amount_cents must be positive' },
        { status: 400 },
      )
    }

    const kind = body.kind === 'payment' ? 'payment' : 'deposit'

    const applicationId = process.env.SQUARE_APPLICATION_ID
    if (
      !applicationId ||
      !process.env.SQUARE_ACCESS_TOKEN ||
      !process.env.SQUARE_LOCATION_ID
    ) {
      return NextResponse.json(
        { error: 'Square payment verification is not fully configured.' },
        { status: 503 },
      )
    }

    const { data: appointment } = await supabase
      .from('ops_appointments')
      .select('id, restoration_project_id, assigned_staff_user_id')
      .eq('id', appointmentId)
      .maybeSingle()
    if (!appointment?.restoration_project_id) {
      return NextResponse.json(
        { error: 'not_a_restoration_visit' },
        { status: 409 },
      )
    }

    if (
      access.role === 'tech' &&
      appointment.assigned_staff_user_id !== access.staff?.id
    ) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const origin = request.nextUrl.origin
    const returnTo =
      typeof body.returnTo === 'string' &&
      body.returnTo.startsWith('/') &&
      !body.returnTo.startsWith('//') &&
      !body.returnTo.includes('\\')
        ? body.returnTo
        : `/admin/operations/restoration/${appointment.restoration_project_id}`

    const context = createSquarePosContext({
      purpose: 'restoration',
      appointmentId,
      amountCents,
      kind,
      returnTo,
      actorId: access.id,
    })
    const url = buildSquarePosUrl({
      platform: detectMobilePlatform(request.headers.get('user-agent')),
      amountCents,
      applicationId,
      callbackUrl: `${origin}/api/admin/ops/restoration/deposit-return`,
      locationId: process.env.SQUARE_LOCATION_ID,
      note: context.note,
      state: context.state,
    })

    return NextResponse.json({ url })
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Failed to build payment link'
    return NextResponse.json(
      { error: message },
      { status: message === 'Not authorized' ? 403 : 500 },
    )
  }
}
