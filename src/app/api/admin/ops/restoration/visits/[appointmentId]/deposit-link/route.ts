import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { buildSquarePosUrl, detectMobilePlatform } from '@/lib/payments/square-pos'

/**
 * Deep link into Square Point of Sale to take the mitigation-day deposit.
 *
 * The existing tech charge route cannot be reused: it requires a chargeable
 * invoice, and a restoration deposit is collected days before any invoice
 * exists. The amount is therefore carried in the state and recorded against the
 * visit when Square returns.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { appointmentId } = await params
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))

    const amountCents = Math.round(Number(body.amount_cents))
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return NextResponse.json({ error: 'amount_cents must be positive' }, { status: 400 })
    }

    const applicationId = process.env.SQUARE_APPLICATION_ID
    if (!applicationId) {
      return NextResponse.json(
        { error: 'Square is not fully configured (missing Application ID).' },
        { status: 503 },
      )
    }

    const { data: appointment } = await supabase
      .from('ops_appointments')
      .select('id, restoration_project_id')
      .eq('id', appointmentId)
      .maybeSingle()
    if (!appointment?.restoration_project_id) {
      return NextResponse.json({ error: 'not_a_restoration_visit' }, { status: 409 })
    }

    const origin = request.nextUrl.origin
    const returnTo =
      typeof body.returnTo === 'string' &&
      body.returnTo.startsWith('/') &&
      !body.returnTo.startsWith('//')
        ? body.returnTo
        : `/admin/operations/restoration/${appointment.restoration_project_id}`

    const url = buildSquarePosUrl({
      platform: detectMobilePlatform(request.headers.get('user-agent')),
      amountCents,
      applicationId,
      callbackUrl: `${origin}/api/admin/ops/restoration/deposit-return`,
      note: 'Water mitigation deposit',
      // Round-tripped by Square untouched, so the return handler knows what to record.
      state: JSON.stringify({ a: appointmentId, c: amountCents, r: returnTo }),
    })

    return NextResponse.json({ url })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to build payment link'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
