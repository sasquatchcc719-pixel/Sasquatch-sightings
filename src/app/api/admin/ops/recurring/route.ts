import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  generateRecurringAppointments,
  generateAllRecurring,
  recurringScheduleCandidates,
  type RecurrenceRule,
} from '@/lib/ops/recurring'
import { previewRecurringSchedule } from '@/lib/ops/recurring-schedule-preview'
import { applyAppointmentBuffer } from '@/lib/ops/availability'
import { planRecurringSchedule } from '@/lib/ops/recurring-scheduling'
import { planBestFitRecurringSchedule } from '@/lib/ops/recurring-best-fit'
import {
  parseRecurringOverrides,
  recurringReviewMatches,
  freezeRecurringVisits,
} from '@/lib/ops/recurring-review'
import { loadRecurringVisitSchedule } from '@/lib/ops/recurring-edits'

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

    if (body.preview_only && Array.isArray(body.rules)) {
      const scheduleInput = body.schedule || {}
      const bestFit = body.find_best_fit === true
      const flexible = bestFit || scheduleInput.scheduling_mode === 'flexible'
      let overrides
      try {
        overrides = parseRecurringOverrides(scheduleInput.visit_overrides)
      } catch (error) {
        return NextResponse.json(
          { error: (error as Error).message },
          { status: 400 },
        )
      }
      let candidates = recurringScheduleCandidates(
        body.rules as RecurrenceRule[],
        String(scheduleInput.start_time || '09:00'),
        { horizonMonths: 12, count: 400 },
      )
      if (flexible && typeof body.template_id === 'string') {
        const saved = await loadRecurringVisitSchedule(
          supabase,
          body.template_id,
          candidates,
          overrides,
        )
        candidates = saved.candidates
        overrides = saved.visitOverrides
      }
      if (
        (scheduleInput.assigned_staff_user_id || bestFit) &&
        scheduleInput.is_subcontracted !== true
      ) {
        const duration = applyAppointmentBuffer(
          Number(scheduleInput.scheduled_duration_minutes) || 120,
        )
        const staffId = String(scheduleInput.assigned_staff_user_id)
        const excludeTemplateId =
          typeof body.template_id === 'string' ? body.template_id : undefined
        if (flexible) {
          const inputs = {
            candidates,
            durationMinutes: duration,
            visitOverrides: overrides,
            excludeTemplateId,
          }
          const schedule = bestFit
            ? await planBestFitRecurringSchedule(supabase, {
                ...inputs,
                preferredStaffUserId: staffId,
              })
            : await planRecurringSchedule(supabase, {
                ...inputs,
                staffUserId: staffId,
                schedulingMode: 'flexible',
              })
          return NextResponse.json({
            preview_dates: schedule.occurrences.map((visit) => visit.date),
            preview_date_details: schedule.occurrences.map((visit) => ({
              date: visit.date,
              original_date: visit.original_date,
              shifted: visit.shifted,
            })),
            ...schedule,
          })
        }
        // Fixed plans can deliberately run after hours; retain that behavior
        // while checking each rule's actual start time and the entire horizon.
        const times = [
          ...new Set(candidates.map((candidate) => candidate.start_time)),
        ]
        const schedules = await Promise.all(
          times.map((startTime) =>
            previewRecurringSchedule(supabase, {
              dates: candidates
                .filter((candidate) => candidate.start_time === startTime)
                .map((candidate) => candidate.date),
              startTime,
              durationMinutes: duration,
              staffUserId: staffId,
              excludeTemplateId,
            }),
          ),
        )
        return NextResponse.json({
          preview_dates: candidates.map((candidate) => candidate.date),
          preview_date_details: candidates.map((candidate) => ({
            ...candidate,
            shifted: candidate.original_date !== candidate.date,
          })),
          occurrences: schedules
            .flatMap((schedule) => schedule.occurrences)
            .sort((a, b) => a.date.localeCompare(b.date)),
          staff: schedules[0]?.staff,
        })
      }
      return NextResponse.json({
        preview_dates: candidates.map((candidate) => candidate.date),
        occurrences: [],
      })
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

    const flexible = tpl.scheduling_mode === 'flexible'
    if (
      tpl.scheduling_mode != null &&
      !['fixed', 'flexible'].includes(tpl.scheduling_mode)
    ) {
      return NextResponse.json(
        { error: 'Choose fixed or flexible scheduling.' },
        { status: 400 },
      )
    }
    let visitOverrides
    try {
      visitOverrides = parseRecurringOverrides(tpl.visit_overrides)
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 400 },
      )
    }
    if (!tpl.assigned_staff_user_id && tpl.is_subcontracted !== true) {
      return NextResponse.json(
        { error: 'Choose the technician for these recurring visits.' },
        { status: 400 },
      )
    }
    if (tpl.assigned_staff_user_id && tpl.is_subcontracted !== true) {
      const candidates = recurringScheduleCandidates(
        rules as RecurrenceRule[],
        String(tpl.start_time || '09:00'),
        { horizonMonths: 12, count: 400 },
      )
      const duration = applyAppointmentBuffer(
        Number(tpl.scheduled_duration_minutes) || 120,
      )
      if (flexible) {
        const schedule = await planRecurringSchedule(supabase, {
          candidates,
          durationMinutes: duration,
          staffUserId: String(tpl.assigned_staff_user_id),
          schedulingMode: 'flexible',
          visitOverrides,
        })
        if (
          !recurringReviewMatches(
            body.reviewed_occurrences,
            schedule.occurrences,
          )
        ) {
          return NextResponse.json(
            {
              error:
                'The calendar or visit choices changed. Find openings again and review the updated dates before creating the plan.',
              code: 'recurring_schedule_changed',
              occurrences: schedule.occurrences,
            },
            { status: 409 },
          )
        }
        // Keep the exact dates the owner reviewed, including unchanged visits.
        visitOverrides = freezeRecurringVisits(
          schedule.occurrences,
          visitOverrides,
        )
      } else {
        const times = [
          ...new Set(candidates.map((candidate) => candidate.start_time)),
        ]
        const schedules = await Promise.all(
          times.map((startTime) =>
            previewRecurringSchedule(supabase, {
              dates: candidates
                .filter((candidate) => candidate.start_time === startTime)
                .map((candidate) => candidate.date),
              startTime,
              durationMinutes: duration,
              staffUserId: String(tpl.assigned_staff_user_id),
            }),
          ),
        )
        const occurrences = schedules.flatMap(
          (schedule) => schedule.occurrences,
        )
        const conflicts = occurrences.filter(
          (occurrence) => occurrence.status === 'conflict',
        )
        if (conflicts.length) {
          return NextResponse.json(
            {
              error: `${conflicts.length} planned visits overlap existing work. Preview the dates and choose another time or flexible scheduling.`,
              code: 'recurring_schedule_conflict',
              occurrences,
            },
            { status: 409 },
          )
        }
      }
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
        assigned_staff_user_id: tpl.assigned_staff_user_id || null,
        is_active: tpl.is_active !== false,
        scheduling_mode: flexible ? 'flexible' : 'fixed',
        visit_overrides: visitOverrides,
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
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to create recurring template',
      },
      { status: 500 },
    )
  }
}
