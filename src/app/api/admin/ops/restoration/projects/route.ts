import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  DEFAULT_MONITOR_VISITS,
  MONITOR_VISIT_MINUTES,
  addMinutes,
} from '@/lib/ops/restoration-projects'

/** Open water-loss projects, newest first — the source for the schedule tray. */
export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('restoration_projects')
      .select(
        `id, status, water_category, source_of_loss, loss_date, after_hours_call,
         created_at, closed_at, invoice_id,
         ops_customers!restoration_projects_customer_id_fkey ( id, full_name, phone ),
         ops_service_addresses ( id, street_1, city, state, zip_code ),
         restoration_visit_queue ( id, visit_type, visit_sequence, duration_minutes, status )`,
      )
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error
    return NextResponse.json({ projects: data ?? [] })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load projects'
    const status = message === 'Not authorized' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

/**
 * Start a water loss: the project, its day-1 mitigation visit on the calendar,
 * and the monitor visits queued (not scheduled — they have to be fitted around
 * carpet cleaning work by hand).
 */
export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const body = await request.json()

    const customerId = String(body.customer_id ?? '')
    const serviceAddressId = String(body.service_address_id ?? '')
    if (!customerId || !serviceAddressId) {
      return NextResponse.json(
        { error: 'customer_id and service_address_id are required' },
        { status: 400 },
      )
    }

    const appointmentDate = String(body.appointment_date ?? '')
    const startTime = String(body.start_time ?? '09:00')
    if (!appointmentDate) {
      return NextResponse.json({ error: 'appointment_date is required' }, { status: 400 })
    }

    const waterCategory = body.water_category != null ? Number(body.water_category) : null
    const durationMinutes = Number(body.duration_minutes ?? 240)
    const monitorVisits = Math.max(
      0,
      Math.min(6, Number(body.monitor_visits ?? DEFAULT_MONITOR_VISITS)),
    )

    const { data: project, error: projectError } = await supabase
      .from('restoration_projects')
      .insert({
        customer_id: customerId,
        service_address_id: serviceAddressId,
        water_category: waterCategory,
        loss_date: body.loss_date ?? null,
        loss_time: body.loss_time ?? null,
        source_of_loss: body.source_of_loss ?? null,
        after_hours_call: Boolean(body.after_hours_call),
        standing_water: Boolean(body.standing_water),
        standing_water_depth_inches: body.standing_water_depth_inches ?? null,
        loss_class: body.loss_class ?? null,
        containment_required: Boolean(body.containment_required),
        cause_narrative: body.cause_narrative ?? null,
        carrier: body.carrier ?? null,
        claim_number: body.claim_number ?? null,
        adjuster_name: body.adjuster_name ?? null,
        adjuster_phone: body.adjuster_phone ?? null,
        deductible: body.deductible ?? null,
      })
      .select('id')
      .single()

    if (projectError || !project) throw projectError ?? new Error('project insert failed')

    // The category at intake is the first dated entry. It can degrade later
    // (S500: Cat 1 -> Cat 2 after ~48h), and line items resolve against the
    // category in effect when the work was performed.
    if (waterCategory) {
      await supabase.from('restoration_category_events').insert({
        project_id: project.id,
        water_category: waterCategory,
        effective_at: new Date().toISOString(),
        reason: 'set at intake',
        recorded_by_user_id: access.id,
      })
    }

    const { data: appointment, error: appointmentError } = await supabase
      .from('ops_appointments')
      .insert({
        customer_id: customerId,
        service_address_id: serviceAddressId,
        booking_channel: 'admin',
        source: 'admin',
        status: 'booked',
        payment_status: 'unpaid',
        quickbooks_sync_status: 'held',
        appointment_date: appointmentDate,
        start_time: startTime,
        end_time: addMinutes(startTime, durationMinutes),
        quoted_total: 0,
        kind: 'restoration',
        restoration_project_id: project.id,
        visit_type: 'mitigation',
        visit_sequence: 1,
        assigned_staff_user_id: body.assigned_staff_user_id ?? null,
        internal_notes: body.internal_notes ?? null,
      })
      .select('id')
      .single()

    if (appointmentError || !appointment) {
      // Do not leave a project with no visit behind.
      await supabase.from('restoration_projects').delete().eq('id', project.id)
      throw appointmentError ?? new Error('appointment insert failed')
    }

    if (monitorVisits > 0) {
      await supabase.from('restoration_visit_queue').insert(
        Array.from({ length: monitorVisits }, (_, i) => ({
          project_id: project.id,
          visit_type: 'monitor' as const,
          visit_sequence: i + 2,
          duration_minutes: MONITOR_VISIT_MINUTES,
        })),
      )
    }

    return NextResponse.json({
      project_id: project.id,
      appointment_id: appointment.id,
      queued_monitor_visits: monitorVisits,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to create project'
    const status = message === 'Not authorized' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
