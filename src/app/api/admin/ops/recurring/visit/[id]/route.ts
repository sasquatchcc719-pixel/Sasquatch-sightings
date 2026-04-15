import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/admin/ops/recurring/visit/[id]
 * Fetch a single recurring appointment + its parent template for the visit detail page.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()

    // Fetch the appointment with full detail
    const { data: appointment, error: apptError } = await supabase
      .from('ops_appointments')
      .select(
        `
        id,
        appointment_date,
        start_time,
        end_time,
        status,
        quoted_total,
        on_my_way_at,
        completed_at,
        internal_notes,
        recurring_template_id,
        ops_customers!ops_appointments_customer_id_fkey (
          id,
          full_name,
          first_name,
          last_name,
          business_name,
          email,
          phone,
          notes
        ),
        ops_service_addresses (
          id,
          label,
          street_1,
          street_2,
          city,
          state,
          zip_code,
          gate_code,
          notes
        ),
        ops_appointment_line_items (
          id,
          service_catalog_item_id,
          name_snapshot,
          quantity,
          unit_price,
          duration_minutes,
          line_total,
          notes
        )
      `,
      )
      .eq('id', id)
      .single()

    if (apptError || !appointment) {
      return NextResponse.json(
        { error: 'Appointment not found' },
        { status: 404 },
      )
    }

    if (!appointment.recurring_template_id) {
      return NextResponse.json(
        { error: 'Not a recurring appointment' },
        { status: 400 },
      )
    }

    // Fetch the parent template for label, invoice_mode, and standing instructions
    const { data: template, error: tplError } = await supabase
      .from('ops_recurring_templates')
      .select('id, label, invoice_mode, internal_notes, line_items')
      .eq('id', appointment.recurring_template_id)
      .single()

    if (tplError || !template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    return NextResponse.json({ appointment, template })
  } catch (error) {
    console.error('[recurring/visit/:id][GET]', error)
    return NextResponse.json({ error: 'Failed to load visit' }, { status: 500 })
  }
}
