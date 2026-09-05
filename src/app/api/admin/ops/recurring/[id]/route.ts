import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  generateRecurringAppointments,
  generateBatchInvoice,
} from '@/lib/ops/recurring'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/admin/ops/recurring/[id]
 * Single template with rules, generated appointments, and batch invoices.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const supabase = createAdminClient()

    const { data: template, error } = await supabase
      .from('ops_recurring_templates')
      .select(
        `
        *,
        ops_customers (id, full_name, business_name, phone, email),
        ops_service_addresses (id, label, street_1, city, state, zip_code),
        ops_recurrence_rules (*)
      `,
      )
      .eq('id', id)
      .single()

    if (error || !template) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { data: appointments } = await supabase
      .from('ops_appointments')
      .select(
        `id, appointment_date, start_time, end_time, status, payment_status,
         quoted_total, on_my_way_at, completed_at, internal_notes,
         ops_appointment_line_items (
           id, service_catalog_item_id, name_snapshot,
           quantity, unit_price, duration_minutes, line_total, notes
         ),
         ops_invoices ( id )`,
      )
      .eq('recurring_template_id', id)
      .order('appointment_date')

    const { data: batchInvoices } = await supabase
      .from('ops_batch_invoices')
      .select('*')
      .eq('template_id', id)
      .order('month', { ascending: false })

    return NextResponse.json({
      template,
      appointments: appointments || [],
      batch_invoices: batchInvoices || [],
    })
  } catch (error) {
    console.error('[recurring/[id]][GET]', error)
    return NextResponse.json(
      { error: 'Failed to load template' },
      { status: 500 },
    )
  }
}

/**
 * PATCH /api/admin/ops/recurring/[id]
 * Update template, toggle active, update rules.
 * Body can include: { template?: {...}, rules?: [...], update_future?: boolean }
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    if (body.template) {
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }
      const allowed = [
        'label',
        'line_items',
        'start_time',
        'scheduled_duration_minutes',
        'discount_amount',
        'internal_notes',
        'invoice_mode',
        'booking_channel',
        'assigned_staff_user_id',
        'is_active',
        'is_subcontracted',
        'subcontractor_name',
      ] as const

      for (const key of allowed) {
        if (body.template[key] !== undefined) {
          updates[key] = body.template[key]
        }
      }

      const { error } = await supabase
        .from('ops_recurring_templates')
        .update(updates)
        .eq('id', id)

      if (error) throw error

      // Flipping the subcontracted flag has to reach the visits already on the
      // books, or the toggle appears to do nothing until the next regeneration.
      // Completed visits are left alone — their history stays as it happened.
      if (
        body.template.is_subcontracted !== undefined ||
        body.template.assigned_staff_user_id !== undefined
      ) {
        const isSub = body.template.is_subcontracted === true
        const appointmentUpdates: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        }
        if (body.template.is_subcontracted !== undefined) {
          appointmentUpdates.is_subcontracted = isSub
          appointmentUpdates.subcontractor_name = isSub
            ? body.template.subcontractor_name || null
            : null
        }
        if (body.template.assigned_staff_user_id !== undefined) {
          appointmentUpdates.assigned_staff_user_id =
            body.template.assigned_staff_user_id || null
        }
        const { error: propagateError } = await supabase
          .from('ops_appointments')
          .update(appointmentUpdates)
          .eq('recurring_template_id', id)
          .not('status', 'in', '("completed","cancelled")')

        if (propagateError) throw propagateError
      }
    }

    if (Array.isArray(body.rules)) {
      await supabase.from('ops_recurrence_rules').delete().eq('template_id', id)

      if (body.rules.length > 0) {
        const rulesPayload = body.rules.map(
          (r: {
            frequency: string
            day_of_week?: number | null
            week_of_month?: number | null
            day_of_month?: number | null
            interval_days?: number | null
            effective_from?: string
            effective_until?: string | null
            override_start_time?: string | null
          }) => ({
            template_id: id,
            frequency: r.frequency,
            day_of_week: r.day_of_week ?? null,
            week_of_month: r.week_of_month ?? null,
            day_of_month: r.day_of_month ?? null,
            interval_days: r.interval_days ?? null,
            effective_from:
              r.effective_from || new Date().toISOString().slice(0, 10),
            effective_until: r.effective_until || null,
            override_start_time: r.override_start_time || null,
          }),
        )

        const { error: rulesErr } = await supabase
          .from('ops_recurrence_rules')
          .insert(rulesPayload)

        if (rulesErr) throw rulesErr
      }
    }

    if (body.update_future) {
      const tpl = body.template
      if (
        tpl?.line_items ||
        tpl?.start_time ||
        tpl?.scheduled_duration_minutes != null
      ) {
        const today = new Date().toISOString().slice(0, 10)

        const { data: futureAppts } = await supabase
          .from('ops_appointments')
          .select('id')
          .eq('recurring_template_id', id)
          .gte('appointment_date', today)
          .in('status', ['booked', 'confirmed'])

        if (futureAppts && futureAppts.length > 0) {
          for (const appt of futureAppts) {
            await supabase.from('ops_appointments').delete().eq('id', appt.id)
            await supabase
              .from('ops_appointment_line_items')
              .delete()
              .eq('appointment_id', appt.id)
            await supabase
              .from('ops_invoices')
              .delete()
              .eq('appointment_id', appt.id)
          }
          await generateRecurringAppointments(supabase, id)
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[recurring/[id]][PATCH]', error)
    return NextResponse.json(
      { error: 'Failed to update template' },
      { status: 500 },
    )
  }
}

/**
 * DELETE /api/admin/ops/recurring/[id]
 * Deletes the template. Generated appointments remain on the calendar.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const supabase = createAdminClient()

    await supabase
      .from('ops_appointments')
      .update({ recurring_template_id: null })
      .eq('recurring_template_id', id)

    const { error } = await supabase
      .from('ops_recurring_templates')
      .delete()
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[recurring/[id]][DELETE]', error)
    return NextResponse.json(
      { error: 'Failed to delete template' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/admin/ops/recurring/[id]
 * Actions: generate appointments or create batch invoice.
 * Body: { action: 'generate' } or { action: 'batch-invoice', month: '2026-05-01' }
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    if (body.action === 'generate') {
      const result = await generateRecurringAppointments(supabase, id)
      return NextResponse.json({ result })
    }

    if (body.action === 'batch-invoice') {
      if (!body.month) {
        return NextResponse.json(
          { error: 'month is required (YYYY-MM-01)' },
          { status: 400 },
        )
      }
      const result = await generateBatchInvoice(supabase, id, body.month)
      if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }
      return NextResponse.json({ result })
    }

    return NextResponse.json(
      { error: 'Unknown action. Use "generate" or "batch-invoice".' },
      { status: 400 },
    )
  } catch (error) {
    console.error('[recurring/[id]][POST]', error)
    return NextResponse.json({ error: 'Action failed' }, { status: 500 })
  }
}
