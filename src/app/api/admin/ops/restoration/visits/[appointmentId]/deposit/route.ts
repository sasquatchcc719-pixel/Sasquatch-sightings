import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * Record the deposit taken on the mitigation day.
 *
 * It is anchored to the visit, not an invoice, because the project's invoice
 * does not exist until the job closes days later. closeRestorationProject
 * attaches it to the invoice it builds and shows it as a credit.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { appointmentId } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const amountCents = Math.round(Number(body.amount_cents))
    if (!Number.isFinite(amountCents) || amountCents === 0) {
      return NextResponse.json({ error: 'amount_cents must be non-zero' }, { status: 400 })
    }

    const method = String(body.method ?? 'square_tap')
    const allowed = ['square_tap', 'square_link', 'square_other', 'cash', 'check', 'card_other', 'other']
    if (!allowed.includes(method)) {
      return NextResponse.json({ error: 'unsupported payment method' }, { status: 400 })
    }

    const { data: appointment } = await supabase
      .from('ops_appointments')
      .select('id, restoration_project_id')
      .eq('id', appointmentId)
      .maybeSingle()
    if (!appointment?.restoration_project_id) {
      return NextResponse.json({ error: 'not_a_restoration_visit' }, { status: 409 })
    }

    const { data, error } = await supabase
      .from('ops_payments')
      .insert({
        appointment_id: appointmentId,
        kind: String(body.kind ?? 'deposit'),
        method,
        amount_cents: amountCents,
        square_payment_id: body.square_payment_id ?? null,
        square_order_id: body.square_order_id ?? null,
        paid_at: body.paid_at ?? new Date().toISOString(),
        recorded_by_user_id: access.id,
        note: body.note ?? null,
      })
      .select('id, kind, method, amount_cents, paid_at')
      .single()

    if (error) throw error
    return NextResponse.json({ payment: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to record payment'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
