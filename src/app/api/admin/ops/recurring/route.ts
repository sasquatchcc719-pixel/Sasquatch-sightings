import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  generateRecurringAppointments,
  generateAllRecurring,
  previewDates,
  type RecurrenceRule,
} from '@/lib/ops/recurring'

/**
 * GET /api/admin/ops/recurring
 * List all recurring templates with their rules and stats.
 */
export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()

    const { data: templates, error } = await supabase
      .from('ops_recurring_templates')
      .select(
        `
        *,
        ops_customers (id, full_name, business_name, phone, email),
        ops_service_addresses (id, label, street_1, city, state, zip_code),
        ops_recurrence_rules (*)
      `,
      )
      .order('created_at', { ascending: false })

    if (error) throw error

    const enriched = await Promise.all(
      (templates || []).map(async (tpl) => {
        const { count } = await supabase
          .from('ops_appointments')
          .select('id', { count: 'exact', head: true })
          .eq('recurring_template_id', tpl.id)

        const { data: nextAppt } = await supabase
          .from('ops_appointments')
          .select('appointment_date')
          .eq('recurring_template_id', tpl.id)
          .gte('appointment_date', new Date().toISOString().slice(0, 10))
          .in('status', ['booked', 'confirmed'])
          .order('appointment_date')
          .limit(1)

        return {
          ...tpl,
          generated_count: count || 0,
          next_date: nextAppt?.[0]?.appointment_date || null,
        }
      }),
    )

    return NextResponse.json({ templates: enriched })
  } catch (error) {
    console.error('[recurring][GET]', error)
    return NextResponse.json(
      { error: 'Failed to load recurring templates' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/admin/ops/recurring
 * Create a new recurring template with rules, optionally generate appointments.
 *
 * Body: { template: {...}, rules: [...], generate?: boolean, preview_only?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const body = await request.json()

    if (body.action === 'generate-all') {
      const results = await generateAllRecurring(supabase)
      return NextResponse.json({ results })
    }

    if (body.preview_only && body.rules) {
      const dates = previewDates(body.rules as RecurrenceRule[], 10)
      return NextResponse.json({ preview_dates: dates })
    }

    const tpl = body.template
    if (!tpl?.customer_id || !tpl?.service_address_id || !tpl?.label) {
      return NextResponse.json(
        { error: 'customer_id, service_address_id, and label are required' },
        { status: 400 },
      )
    }

    if (!Array.isArray(tpl.line_items) || tpl.line_items.length === 0) {
      return NextResponse.json(
        { error: 'At least one line item is required' },
        { status: 400 },
      )
    }

    const rules = body.rules
    if (!Array.isArray(rules) || rules.length === 0) {
      return NextResponse.json(
        { error: 'At least one recurrence rule is required' },
        { status: 400 },
      )
    }

    const { data: template, error: tplErr } = await supabase
      .from('ops_recurring_templates')
      .insert({
        customer_id: tpl.customer_id,
        service_address_id: tpl.service_address_id,
        label: tpl.label,
        line_items: tpl.line_items,
        start_time: tpl.start_time || '09:00',
        scheduled_duration_minutes: tpl.scheduled_duration_minutes || 120,
        discount_amount: tpl.discount_amount || 0,
        internal_notes: tpl.internal_notes || null,
        invoice_mode: tpl.invoice_mode || 'per_visit',
        booking_channel: tpl.booking_channel || 'recurring',
        is_active: tpl.is_active !== false,
        is_subcontracted: tpl.is_subcontracted === true,
        subcontractor_name:
          tpl.is_subcontracted === true
            ? String(tpl.subcontractor_name || '').trim() || null
            : null,
      })
      .select()
      .single()

    if (tplErr || !template) {
      return NextResponse.json(
        { error: tplErr?.message || 'Failed to create template' },
        { status: 500 },
      )
    }

    const rulesPayload = rules.map(
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
        template_id: template.id,
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

    if (rulesErr) {
      return NextResponse.json({ error: rulesErr.message }, { status: 500 })
    }

    let generation = null
    if (body.generate !== false) {
      generation = await generateRecurringAppointments(supabase, template.id)
    }

    return NextResponse.json({ template, generation }, { status: 201 })
  } catch (error) {
    console.error('[recurring][POST]', error)
    return NextResponse.json(
      { error: 'Failed to create recurring template' },
      { status: 500 },
    )
  }
}
