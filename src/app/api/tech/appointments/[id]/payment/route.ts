import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  getAssignedTechAppointment,
  shouldHideTechPricing,
} from '@/lib/tech/appointments'
import { createAdminClient } from '@/supabase/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const { id } = await params
    const appointment = await getAssignedTechAppointment(
      supabase,
      access.id,
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

    const { method } = await request.json().catch(() => ({ method: 'square' }))
    const paymentMethod = String(method || 'square').toLowerCase()
    const allowedMethods = new Set(['square', 'venmo', 'cash', 'check'])
    if (!allowedMethods.has(paymentMethod)) {
      return NextResponse.json(
        { error: 'Unsupported payment method' },
        { status: 400 },
      )
    }

    const { data: current, error: currentError } = await supabase
      .from('ops_appointments')
      .select(
        `
          id,
          ops_customers!ops_appointments_customer_id_fkey (
            full_name,
            business_name
          ),
          ops_recurring_templates (
            invoice_mode
          )
        `,
      )
      .eq('id', id)
      .eq('assigned_staff_user_id', access.id)
      .single()

    if (currentError) throw currentError
    if (shouldHideTechPricing(current)) {
      return NextResponse.json(
        { error: 'Payment collection is unavailable for this job' },
        { status: 403 },
      )
    }

    const nowIso = new Date().toISOString()
    await supabase
      .from('ops_invoices')
      .update({
        status: 'paid',
        payment_status: 'paid',
        payment_method: paymentMethod,
        updated_at: nowIso,
      })
      .eq('id', appointment.invoice.id)

    await supabase
      .from('ops_appointments')
      .update({
        payment_status: 'paid',
        updated_at: nowIso,
      })
      .eq('id', id)

    const updated = await getAssignedTechAppointment(supabase, access.id, id)
    return NextResponse.json({ appointment: updated })
  } catch (error) {
    console.error('[tech/appointments/:id/payment][POST]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'Failed to record payment' },
      { status },
    )
  }
}
