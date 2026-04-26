import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

type Params = { params: Promise<{ id: string }> }

/**
 * GET — active recurring templates for this job's customer + service address
 * (used to offer a one-click re-link when recurring_template_id was cleared).
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech', 'marketing'])
    const { id } = await params
    const supabase = createAdminClient()

    const { data: appt, error: apptErr } = await supabase
      .from('ops_appointments')
      .select('id, customer_id, service_address_id, kind')
      .eq('id', id)
      .single()

    if (apptErr || !appt) {
      return NextResponse.json(
        { error: 'Appointment not found' },
        { status: 404 },
      )
    }

    if (appt.kind === 'estimate') {
      return NextResponse.json({
        templates: [] as { id: string; label: string }[],
      })
    }

    const { data: rows, error: tErr } = await supabase
      .from('ops_recurring_templates')
      .select('id, label')
      .eq('is_active', true)
      .eq('customer_id', appt.customer_id)
      .eq('service_address_id', appt.service_address_id)
      .order('label')

    if (tErr) throw tErr

    return NextResponse.json({ templates: rows || [] })
  } catch (error) {
    console.error('[recurring-link-options][GET]', error)
    return NextResponse.json(
      { error: 'Failed to load recurring options' },
      { status: 500 },
    )
  }
}
