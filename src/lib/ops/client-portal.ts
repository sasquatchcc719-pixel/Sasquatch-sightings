import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Client-portal data helpers. Everything here is scoped by a single customer_id —
 * the caller is responsible for passing the customer_id that belongs to the
 * authenticated client_manager (never trust client-supplied ids).
 */

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th']

/**
 * Supabase typed embeds are declared as arrays even for to-one relations.
 * Normalize to a single object (or null) regardless of runtime shape.
 */
function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel ?? null
}

export type RecurrenceRuleRow = {
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'custom'
  day_of_week: number | null
  week_of_month: number | null
  day_of_month: number | null
  interval_days: number | null
  effective_from: string | null
  effective_until: string | null
  override_start_time: string | null
}

/** Human-readable description of a recurrence rule, e.g. "Every Tuesday" or "Monthly on the 2nd Tuesday". */
export function describeRule(rule: RecurrenceRuleRow): string {
  const day =
    rule.day_of_week != null ? (DAY_NAMES[rule.day_of_week] ?? '') : ''

  if (rule.frequency === 'weekly') {
    return day ? `Every ${day}` : 'Weekly'
  }
  if (rule.frequency === 'biweekly') {
    return day ? `Every other ${day}` : 'Every 2 weeks'
  }
  if (rule.frequency === 'monthly') {
    if (rule.week_of_month && day) {
      return `Monthly on the ${ORDINALS[rule.week_of_month] ?? `${rule.week_of_month}th`} ${day}`
    }
    if (rule.day_of_month) {
      return `Monthly on the ${rule.day_of_month}${ordinalSuffix(rule.day_of_month)}`
    }
    return 'Monthly'
  }
  if (rule.frequency === 'custom' && rule.interval_days) {
    return `Every ${rule.interval_days} days`
  }
  return 'Recurring'
}

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] ?? s[v] ?? s[0]
}

/** Format a dollar amount, e.g. 875 -> "$875.00", 0.35 -> "$0.35". */
export function formatMoney(n: number): string {
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Format a TIME string (HH:MM:SS) into a friendly 12-hour label. */
export function formatTime(time: string | null | undefined): string {
  if (!time) return ''
  const [hStr, mStr] = time.split(':')
  let h = Number(hStr)
  const m = mStr ?? '00'
  const period = h >= 12 ? 'PM' : 'AM'
  if (h === 0) h = 12
  else if (h > 12) h -= 12
  return `${h}:${m} ${period}`
}

export type ClientLineItem = {
  id: string
  name_snapshot: string
  quantity: number
  unit_price: number
  line_total: number
  duration_minutes: number
  notes: string | null
}

export type ClientAppointment = {
  id: string
  appointment_date: string
  start_time: string
  end_time: string
  status: string
  client_note: string | null
  recurring_template_id: string | null
  template_label: string | null
  line_items: ClientLineItem[]
}

export type ClientTemplateLineItem = {
  name: string
  notes: string | null
  quantity: number
  unitPrice: number
}

export type ClientTemplate = {
  id: string
  label: string
  start_time: string
  is_active: boolean
  schedule: string[]
  lineItems: ClientTemplateLineItem[]
  discount: number
  total: number
  address: string | null
}

export type ClientRequest = {
  id: string
  request_type: string
  status: string
  message: string | null
  details: Record<string, unknown>
  admin_notes: string | null
  appointment_id: string | null
  created_at: string
  resolved_at: string | null
}

export type ClientPortalData = {
  templates: ClientTemplate[]
  appointments: ClientAppointment[]
  requests: ClientRequest[]
}

/** Load everything a client_manager can see for their customer, fully scoped by customer_id. */
export async function loadClientPortalData(
  supabase: SupabaseClient,
  customerId: string,
): Promise<ClientPortalData> {
  // Active recurring templates (the "intervals") for this customer.
  const { data: templateRows, error: templateError } = await supabase
    .from('ops_recurring_templates')
    .select(
      `id, label, start_time, is_active, line_items, discount_amount,
       ops_recurrence_rules (*),
       ops_service_addresses (label, street_1, city, state, zip_code)`,
    )
    .eq('customer_id', customerId)
    .eq('is_active', true)
    .order('label')
  if (templateError) throw templateError

  const templates: ClientTemplate[] = (templateRows || []).map((t) => {
    const addr = pickOne(t.ops_service_addresses) as {
      label: string | null
      street_1: string | null
      city: string | null
      state: string | null
      zip_code: string | null
    } | null
    const rules = (t.ops_recurrence_rules ?? []) as RecurrenceRuleRow[]
    const rawItems = (t.line_items ?? []) as Array<{
      name_snapshot?: string
      name?: string
      notes?: string | null
      quantity?: number | string
      unit_price?: number | string
    }>
    const lineItems = rawItems
      .map((li) => ({
        name: li.name_snapshot || li.name || '',
        notes: li.notes ?? null,
        quantity: Number(li.quantity ?? 0),
        unitPrice: Number(li.unit_price ?? 0),
      }))
      .filter((li) => li.name)
    const discount = Number(t.discount_amount ?? 0)
    const subtotal = lineItems.reduce(
      (sum, li) => sum + li.quantity * li.unitPrice,
      0,
    )
    return {
      id: t.id as string,
      label: t.label as string,
      start_time: t.start_time as string,
      is_active: t.is_active as boolean,
      schedule: rules.map((r) => describeRule(r)),
      lineItems,
      discount,
      total: Math.max(0, subtotal - discount),
      address: addr
        ? [addr.label, addr.street_1, addr.city].filter(Boolean).join(' · ') ||
          null
        : null,
    }
  })

  // All appointments for this customer (recurring + one-off), recent + upcoming.
  const { data: apptRows, error: appointmentError } = await supabase
    .from('ops_appointments')
    .select(
      `id, appointment_date, start_time, end_time, status, client_note, recurring_template_id,
       ops_recurring_templates ( label ),
       ops_appointment_line_items ( id, name_snapshot, quantity, unit_price, line_total, duration_minutes, notes )`,
    )
    .eq('customer_id', customerId)
    .eq('kind', 'service')
    .neq('status', 'cancelled')
    .order('appointment_date')
  if (appointmentError) throw appointmentError

  const appointments: ClientAppointment[] = (apptRows || []).map((a) => {
    const tpl = pickOne(a.ops_recurring_templates) as {
      label: string | null
    } | null
    return {
      id: a.id as string,
      appointment_date: a.appointment_date as string,
      start_time: a.start_time as string,
      end_time: a.end_time as string,
      status: a.status as string,
      client_note: (a.client_note ?? null) as string | null,
      recurring_template_id: (a.recurring_template_id ?? null) as string | null,
      template_label: tpl?.label ?? null,
      line_items: (
        (a.ops_appointment_line_items ?? []) as ClientLineItem[]
      ).map((li) => ({
        id: li.id,
        name_snapshot: li.name_snapshot,
        quantity: Number(li.quantity),
        unit_price: Number(li.unit_price),
        line_total: Number(li.line_total),
        duration_minutes: Number(li.duration_minutes),
        notes: li.notes ?? null,
      })),
    }
  })

  // This client's change requests / activity log.
  const { data: requestRows, error: requestError } = await supabase
    .from('ops_client_change_requests')
    .select(
      'id, request_type, status, message, details, admin_notes, appointment_id, created_at, resolved_at',
    )
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (requestError) throw requestError

  const requests: ClientRequest[] = (requestRows || []).map((r) => ({
    id: r.id as string,
    request_type: r.request_type as string,
    status: r.status as string,
    message: (r.message ?? null) as string | null,
    details: (r.details ?? {}) as Record<string, unknown>,
    admin_notes: (r.admin_notes ?? null) as string | null,
    appointment_id: (r.appointment_id ?? null) as string | null,
    created_at: r.created_at as string,
    resolved_at: (r.resolved_at ?? null) as string | null,
  }))

  return { templates, appointments, requests }
}
