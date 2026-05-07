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
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const { id } = await params
    const supabase = createAdminClient()

    // Single query — join template via FK so we only need one DB round trip
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
        ),
        ops_recurring_templates (
          id,
          label,
          invoice_mode,
          internal_notes,
          line_items
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

    const template = Array.isArray(appointment.ops_recurring_templates)
      ? appointment.ops_recurring_templates[0]
      : appointment.ops_recurring_templates

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    // Return in the same shape the client expects
    const { ops_recurring_templates: _tpl, ...apptWithoutTpl } = appointment
    return NextResponse.json({ appointment: apptWithoutTpl, template })
  } catch (error) {
    console.error('[recurring/visit/:id][GET]', error)
    return NextResponse.json({ error: 'Failed to load visit' }, { status: 500 })
  }
}
