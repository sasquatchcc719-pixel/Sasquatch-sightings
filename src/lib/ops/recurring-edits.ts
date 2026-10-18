import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  RecurringCandidate,
  RecurringVisitOverrides,
} from './recurring-scheduling'
import type {
  RecurringTemplate,
  RecurrenceRule,
  TemplateLineItem,
} from './recurring'

const nullableNumber = (value: unknown) =>
  value == null || value === '' ? null : Number(value)

export function recurringItemContent(item: TemplateLineItem) {
  return JSON.stringify({
    service: item.service_catalog_item_id || null,
    name: item.name_snapshot,
    quantity: Number(item.quantity),
    price: Number(item.unit_price),
    duration: Number(item.duration_minutes),
    buffer: Number(item.buffer_minutes || 0),
    unit: item.pricing_unit_snapshot || null,
    length: nullableNumber(item.length_value),
    width: nullableNumber(item.width_value),
    area: item.area_segments || null,
  })
}

export function recurringRulesContent(rules: Partial<RecurrenceRule>[]) {
  return JSON.stringify(
    rules
      .map((rule) =>
        JSON.stringify({
          frequency: rule.frequency,
          day: nullableNumber(rule.day_of_week),
          week: nullableNumber(rule.week_of_month),
          monthDay: nullableNumber(rule.day_of_month),
          interval: nullableNumber(rule.interval_days),
          from: rule.effective_from,
          until: rule.effective_until || null,
          time: rule.override_start_time?.slice(0, 5) || null,
        }),
      )
      .sort(),
  )
}

const recurringOverridesContent = (
  overrides?: RecurringVisitOverrides | null,
) =>
  JSON.stringify(
    Object.entries(overrides || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => [date, value.date, value.start_time.slice(0, 5)]),
  )

export function recurringEditsNeedRegeneration(
  current: RecurringTemplate & { ops_recurrence_rules: RecurrenceRule[] },
  updates: Partial<RecurringTemplate>,
  rules?: Partial<RecurrenceRule>[],
) {
  if (
    rules &&
    recurringRulesContent(rules) !==
      recurringRulesContent(current.ops_recurrence_rules)
  )
    return true
  if (
    updates.line_items &&
    JSON.stringify(updates.line_items.map(recurringItemContent)) !==
      JSON.stringify(current.line_items.map(recurringItemContent))
  )
    return true
  if (
    updates.start_time !== undefined &&
    updates.start_time.slice(0, 5) !== current.start_time.slice(0, 5)
  )
    return true
  if (
    (current.scheduling_mode === 'flexible' ||
      updates.scheduling_mode === 'flexible') &&
    ((updates.scheduling_mode !== undefined &&
      updates.scheduling_mode !== (current.scheduling_mode || 'fixed')) ||
      (updates.assigned_staff_user_id !== undefined &&
        (updates.assigned_staff_user_id || null) !==
          (current.assigned_staff_user_id || null)) ||
      (updates.is_subcontracted !== undefined &&
        updates.is_subcontracted !== current.is_subcontracted) ||
      (updates.visit_overrides !== undefined &&
        recurringOverridesContent(updates.visit_overrides) !==
          recurringOverridesContent(current.visit_overrides)))
  )
    return true
  if (
    updates.invoice_mode !== undefined &&
    updates.invoice_mode !== current.invoice_mode
  )
    return true
  return (['scheduled_duration_minutes', 'discount_amount'] as const).some(
    (key) =>
      updates[key] !== undefined &&
      Number(updates[key]) !== Number(current[key]),
  )
}

export type ExistingRecurringVisit = {
  id: string
  original_recurring_date: string | null
  appointment_date: string
  start_time: string
  end_time: string
  status: string
}

/** Preserve individual calendar moves unless this preview explicitly changes them. */
export async function loadRecurringVisitSchedule(
  supabase: SupabaseClient,
  templateId: string,
  candidates: RecurringCandidate[],
  requestedOverrides: RecurringVisitOverrides,
  persistedOverrides?: RecurringVisitOverrides,
) {
  let saved = persistedOverrides
  if (saved === undefined) {
    const { data, error } = await supabase
      .from('ops_recurring_templates')
      .select('visit_overrides')
      .eq('id', templateId)
      .single()
    if (error) throw error
    saved = (data?.visit_overrides || {}) as RecurringVisitOverrides
  }
  const { data, error } = await supabase
    .from('ops_appointments')
    .select(
      'id, original_recurring_date, appointment_date, start_time, end_time, status',
    )
    .eq('recurring_template_id', templateId)
  if (error) throw error
  const visits = (data || []) as ExistingRecurringVisit[]
  const protectedOriginals = new Set(
    visits
      .filter((visit) =>
        ['completed', 'cancelled', 'on_my_way', 'in_progress'].includes(
          visit.status,
        ),
      )
      .map((visit) => visit.original_recurring_date || visit.appointment_date),
  )
  const visitOverrides = { ...requestedOverrides }
  for (const visit of visits) {
    if (!['booked', 'confirmed'].includes(visit.status)) continue
    const original = visit.original_recurring_date || visit.appointment_date
    const requested = requestedOverrides[original]
    const persisted = saved[original]
    if (
      !requested ||
      (persisted &&
        requested.date === persisted.date &&
        requested.start_time.slice(0, 5) === persisted.start_time.slice(0, 5))
    ) {
      visitOverrides[original] = {
        date: visit.appointment_date,
        start_time: visit.start_time.slice(0, 5),
      }
    }
  }
  return {
    candidates: candidates.filter(
      (candidate) => !protectedOriginals.has(candidate.original_date),
    ),
    visitOverrides,
    visits,
  }
}
