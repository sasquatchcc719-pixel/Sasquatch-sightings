import { sortLineItems } from '@/lib/ops/line-item-order'
import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  generateRecurringAppointments,
  generateBatchInvoice,
  recurringScheduleCandidates,
  type RecurringTemplate,
  type RecurrenceRule,
  type TemplateLineItem,
} from '@/lib/ops/recurring'
import {
  recurringEditsNeedRegeneration,
  recurringItemContent,
  recurringRulesContent,
  loadRecurringVisitSchedule,
  type ExistingRecurringVisit,
} from '@/lib/ops/recurring-edits'

import { applyAppointmentBuffer } from '@/lib/ops/availability'
import {
  planRecurringSchedule,
  type RecurringScheduleOccurrence,
} from '@/lib/ops/recurring-scheduling'
import {
  parseRecurringOverrides,
  recurringReviewMatches,
  freezeRecurringVisits,
} from '@/lib/ops/recurring-review'

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
        `id, original_recurring_date, appointment_date, start_time, end_time, status, payment_status,
         quoted_total, on_my_way_at, completed_at, internal_notes,
         ops_appointment_line_items (
           id, sort_order, created_at, service_catalog_item_id, name_snapshot,
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
      appointments: (appointments || []).map((appointment) => ({
        ...appointment,
        ops_appointment_line_items: sortLineItems(
          appointment.ops_appointment_line_items || [],
        ),
      })),
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

    const { data: current, error: currentError } = await supabase
      .from('ops_recurring_templates')
      .select('*, ops_recurrence_rules(*)')
      .eq('id', id)
      .single()
    if (currentError || !current) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const previous = current as RecurringTemplate & {
      ops_recurrence_rules: RecurrenceRule[]
    }
    const tplUpdates = { ...(body.template || {}) }
    if (
      tplUpdates.scheduling_mode !== undefined &&
      !['fixed', 'flexible'].includes(tplUpdates.scheduling_mode)
    ) {
      return NextResponse.json(
        { error: 'Choose fixed or flexible scheduling.' },
        { status: 400 },
      )
    }
    if (tplUpdates.visit_overrides !== undefined) {
      try {
        tplUpdates.visit_overrides = parseRecurringOverrides(
          tplUpdates.visit_overrides,
        )
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Invalid visit adjustments.',
          },
          { status: 400 },
        )
      }
    }
    const nextTemplate = { ...previous, ...tplUpdates } as RecurringTemplate
    const needsRegeneration = recurringEditsNeedRegeneration(
      previous,
      tplUpdates,
      body.rules,
    )
    const flexibleEdit =
      previous.scheduling_mode === 'flexible' ||
      nextTemplate.scheduling_mode === 'flexible'
    let flexibleSchedule: {
      visits: ExistingRecurringVisit[]
      occurrences: RecurringScheduleOccurrence[]
    } | null = null
    if (body.update_future && needsRegeneration && flexibleEdit) {
      const unsafeChanges = recurringEditsNeedRegeneration(
        previous,
        {
          ...(tplUpdates.line_items !== undefined
            ? { line_items: tplUpdates.line_items }
            : {}),
          ...(tplUpdates.discount_amount !== undefined
            ? { discount_amount: tplUpdates.discount_amount }
            : {}),
          ...(tplUpdates.invoice_mode !== undefined
            ? { invoice_mode: tplUpdates.invoice_mode }
            : {}),
        },
        body.rules,
      )
      if (unsafeChanges) {
        return NextResponse.json(
          {
            error:
              'Changing the recurrence pattern, prices, or billing mode cannot replace existing flexible visits. Save the plan only, then edit the affected visits individually.',
            code: 'recurring_existing_visits_preserved',
          },
          { status: 409 },
        )
      }
      if (
        !nextTemplate.assigned_staff_user_id ||
        nextTemplate.is_subcontracted
      ) {
        return NextResponse.json(
          {
            error:
              'Choose an active technician to review changes to existing flexible visits.',
          },
          { status: 400 },
        )
      }
      const requested = parseRecurringOverrides(nextTemplate.visit_overrides)
      const prepared = await loadRecurringVisitSchedule(
        supabase,
        id,
        recurringScheduleCandidates(
          previous.ops_recurrence_rules,
          nextTemplate.start_time,
          { horizonMonths: 12, count: 400 },
        ),
        requested,
        previous.visit_overrides || {},
      )
      const schedule = await planRecurringSchedule(supabase, {
        candidates: prepared.candidates,
        staffUserId: nextTemplate.assigned_staff_user_id,
        durationMinutes: applyAppointmentBuffer(
          Number(nextTemplate.scheduled_duration_minutes) || 120,
        ),
        schedulingMode: nextTemplate.scheduling_mode || 'fixed',
        visitOverrides: prepared.visitOverrides,
        excludeTemplateId: id,
      })
      if (
        !recurringReviewMatches(body.reviewed_occurrences, schedule.occurrences)
      ) {
        return NextResponse.json(
          {
            error:
              'The calendar or selected visits changed. Preview the schedule again before saving.',
            code: 'recurring_schedule_review_required',
            occurrences: schedule.occurrences,
          },
          { status: 409 },
        )
      }
      tplUpdates.visit_overrides = freezeRecurringVisits(
        schedule.occurrences,
        prepared.visitOverrides,
      )
      body.template = tplUpdates
      flexibleSchedule = {
        visits: prepared.visits,
        occurrences: schedule.occurrences,
      }
    }

    if (body.template) {
      body.template = tplUpdates
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
        'scheduling_mode',
        'visit_overrides',
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
        !flexibleEdit &&
        (body.template.is_subcontracted !== undefined ||
          body.template.assigned_staff_user_id !== undefined)
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

    if (
      Array.isArray(body.rules) &&
      recurringRulesContent(body.rules) !==
        recurringRulesContent(previous.ops_recurrence_rules)
    ) {
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
      if (flexibleSchedule) {
        const today = new Date().toLocaleDateString('en-CA', {
          timeZone: 'America/Denver',
        })
        const byOriginal = new Map(
          flexibleSchedule.occurrences.map((visit) => [
            visit.original_date,
            visit,
          ]),
        )
        for (const visit of flexibleSchedule.visits) {
          if (
            !['booked', 'confirmed'].includes(visit.status) ||
            visit.appointment_date < today
          )
            continue
          const selected = byOriginal.get(
            visit.original_recurring_date || visit.appointment_date,
          )
          if (!selected) continue
          const { error } = await supabase
            .from('ops_appointments')
            .update({
              appointment_date: selected.date,
              start_time: selected.start_time,
              end_time: selected.end_time,
              assigned_staff_user_id: nextTemplate.assigned_staff_user_id,
              is_subcontracted: nextTemplate.is_subcontracted === true,
              subcontractor_name: nextTemplate.is_subcontracted
                ? nextTemplate.subcontractor_name
                : null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', visit.id)
            .in('status', ['booked', 'confirmed'])
          if (error) throw error
        }
      } else if (needsRegeneration) {
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
      if (!needsRegeneration || flexibleSchedule) {
        // A note edit must keep appointment/invoice IDs and must not fire the
        // AFTER INSERT booking notification trigger.
        const today = new Date().toISOString().slice(0, 10)
        if (
          tpl?.internal_notes !== undefined &&
          (tpl.internal_notes || null) !== (previous.internal_notes || null)
        ) {
          const { error } = await supabase
            .from('ops_appointments')
            .update({
              internal_notes: tpl.internal_notes,
              updated_at: new Date().toISOString(),
            })
            .eq('recurring_template_id', id)
            .gte('appointment_date', today)
            .in('status', ['booked', 'confirmed'])
          if (error) throw error
        }
        const changedNotes = (tpl?.line_items || [])
          .map((item: TemplateLineItem, index: number) => ({
            before: previous.line_items[index],
            after: item,
          }))
          .filter(
            ({
              before,
              after,
            }: {
              before: TemplateLineItem
              after: TemplateLineItem
            }) => (before.notes || null) !== (after.notes || null),
          )
        if (changedNotes.length) {
          const { data: visits, error } = await supabase
            .from('ops_appointments')
            .select('ops_appointment_line_items(*)')
            .eq('recurring_template_id', id)
            .gte('appointment_date', today)
            .in('status', ['booked', 'confirmed'])
          if (error) throw error
          for (const visit of visits || []) {
            const used = new Set<string>()
            for (const { before, after } of changedNotes) {
              const line = visit.ops_appointment_line_items.find(
                (line: TemplateLineItem & { id: string }) =>
                  !used.has(line.id) &&
                  recurringItemContent(line) === recurringItemContent(before) &&
                  (line.notes || null) === (before.notes || null),
              )
              if (!line) continue // Preserve notes customized on an individual visit.
              used.add(line.id)
              const { error: noteError } = await supabase
                .from('ops_appointment_line_items')
                .update({ notes: after.notes || null })
                .eq('id', line.id)
              if (noteError) throw noteError
            }
          }
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
