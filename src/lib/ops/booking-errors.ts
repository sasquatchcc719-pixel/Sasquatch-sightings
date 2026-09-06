import type { SupabaseClient } from '@supabase/supabase-js'

export const BOOKING_ERROR_STAGES = [
  'services',
  'calendar',
  'times',
  'submit',
] as const

export type BookingErrorStage = (typeof BOOKING_ERROR_STAGES)[number]

export type BookingErrorInput = {
  sessionId: string
  stage: BookingErrorStage
  errorMessage: string
  httpStatus: number | null
  quoteTotal: number
  itemCount: number
  appointmentDate: string | null
  customerName: string | null
  customerPhone: string | null
  customerEmail: string | null
  referrer: string | null
  landingPath: string | null
  userAgent: string | null
  metadata: Record<string, unknown>
}

export type BookingErrorRow = {
  id: string
  session_id: string
  stage: BookingErrorStage
  error_message: string
  http_status: number | null
  quote_total: number | string
  item_count: number
  appointment_date: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_email: string | null
  landing_path: string | null
  user_agent: string | null
  occurrence_count: number
  first_seen_at: string
  last_seen_at: string
  recovered_at: string | null
  alert_sent_at: string | null
  alert_error: string | null
}

export type BookingErrorSummary = {
  totalEvents: number
  affectedSessions: number
  unresolvedSessions: number
  last24Hours: number
  alertDeliveryFailures: number
  byStage: {
    stage: BookingErrorStage
    label: string
    events: number
    sessions: number
  }[]
  recent: {
    id: string
    sessionId: string
    stage: BookingErrorStage
    stageLabel: string
    errorMessage: string
    httpStatus: number | null
    quoteTotal: number
    itemCount: number
    appointmentDate: string | null
    customerName: string | null
    customerPhone: string | null
    customerEmail: string | null
    landingPath: string | null
    device: string
    occurrenceCount: number
    firstSeenAt: string
    lastSeenAt: string
    recoveredAt: string | null
    alertSentAt: string | null
    alertError: string | null
  }[]
}

const STAGE_LABELS: Record<BookingErrorStage, string> = {
  services: 'Services would not load',
  calendar: 'Calendar would not load',
  times: 'Times would not load',
  submit: 'Booking would not submit',
}

function cleanText(value: unknown, max: number): string | null {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? cleaned.slice(0, max) : null
}

function nonNegativeNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

export function isBookingErrorStage(value: string): value is BookingErrorStage {
  return (BOOKING_ERROR_STAGES as readonly string[]).includes(value)
}

export function bookingErrorStageLabel(stage: BookingErrorStage): string {
  return STAGE_LABELS[stage]
}

export function normalizeBookingErrorInput(
  body: Record<string, unknown>,
  userAgent: string | null,
): BookingErrorInput | null {
  const sessionId = cleanText(body.session_id, 64) || ''
  const stage = cleanText(body.stage, 30) || ''
  const errorMessage = cleanText(body.error_message, 600) || ''
  if (
    !/^[a-zA-Z0-9_-]{3,64}$/.test(sessionId) ||
    !isBookingErrorStage(stage) ||
    !errorMessage
  ) {
    return null
  }

  const rawStatus = body.http_status
  const httpStatus =
    typeof rawStatus === 'number' &&
    Number.isInteger(rawStatus) &&
    rawStatus >= 0 &&
    rawStatus <= 599
      ? rawStatus
      : null
  const appointmentDate = cleanText(body.appointment_date, 10)
  const metadata =
    body.metadata &&
    typeof body.metadata === 'object' &&
    !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {}

  return {
    sessionId,
    stage,
    errorMessage,
    httpStatus,
    quoteTotal: Math.round(nonNegativeNumber(body.quote_total) * 100) / 100,
    itemCount: Math.floor(nonNegativeNumber(body.item_count)),
    appointmentDate:
      appointmentDate && /^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)
        ? appointmentDate
        : null,
    customerName: cleanText(body.customer_name, 120),
    customerPhone: cleanText(body.customer_phone, 50),
    customerEmail: cleanText(body.customer_email, 160),
    referrer: cleanText(body.referrer, 300),
    landingPath: cleanText(body.landing_path, 300),
    userAgent: cleanText(userAgent, 500),
    metadata,
  }
}

export async function recordBookingError(
  supabase: SupabaseClient,
  input: BookingErrorInput,
): Promise<{ event: BookingErrorRow; shouldAlert: boolean }> {
  const { data: existing, error: lookupError } = await supabase
    .from('booking_error_events')
    .select('*')
    .eq('session_id', input.sessionId)
    .eq('stage', input.stage)
    .maybeSingle()

  if (lookupError) throw lookupError

  const now = new Date().toISOString()
  const values = {
    error_message: input.errorMessage,
    http_status: input.httpStatus,
    quote_total: input.quoteTotal,
    item_count: input.itemCount,
    appointment_date: input.appointmentDate,
    customer_name: input.customerName || existing?.customer_name || null,
    customer_phone: input.customerPhone || existing?.customer_phone || null,
    customer_email: input.customerEmail || existing?.customer_email || null,
    referrer: input.referrer,
    landing_path: input.landingPath,
    user_agent: input.userAgent,
    metadata: input.metadata,
    last_seen_at: now,
  }

  if (existing) {
    const reopened = Boolean(existing.recovered_at)
    const { data, error } = await supabase
      .from('booking_error_events')
      .update({
        ...values,
        occurrence_count: Number(existing.occurrence_count || 1) + 1,
        ...(reopened
          ? {
              recovered_at: null,
              appointment_id: null,
              alert_sent_at: null,
              alert_error: null,
            }
          : {}),
      })
      .eq('id', existing.id)
      .select('*')
      .single()
    if (error) throw error
    return {
      event: data as BookingErrorRow,
      shouldAlert:
        reopened || !existing.alert_sent_at || Boolean(existing.alert_error),
    }
  }

  const { data, error } = await supabase
    .from('booking_error_events')
    .insert({
      session_id: input.sessionId,
      stage: input.stage,
      ...values,
      first_seen_at: now,
    })
    .select('*')
    .single()
  if (error) throw error
  return { event: data as BookingErrorRow, shouldAlert: true }
}

export async function markBookingErrorAlert(
  supabase: SupabaseClient,
  eventId: string,
  sent: boolean,
): Promise<void> {
  await supabase
    .from('booking_error_events')
    .update(
      sent
        ? { alert_sent_at: new Date().toISOString(), alert_error: null }
        : { alert_error: 'Telegram delivery failed' },
    )
    .eq('id', eventId)
}

export async function markBookingErrorsRecovered(
  supabase: SupabaseClient,
  sessionId: string,
  appointmentId: string,
): Promise<void> {
  const { error } = await supabase
    .from('booking_error_events')
    .update({
      recovered_at: new Date().toISOString(),
      appointment_id: appointmentId,
    })
    .eq('session_id', sessionId)
    .is('recovered_at', null)
  if (error) throw error
}

export function bookingErrorDeviceLabel(userAgent: string | null): string {
  const value = String(userAgent || '')
  const device = /iPhone/i.test(value)
    ? 'iPhone'
    : /iPad/i.test(value)
      ? 'iPad'
      : /Android/i.test(value)
        ? 'Android'
        : /Windows/i.test(value)
          ? 'Windows'
          : /Macintosh/i.test(value)
            ? 'Mac'
            : 'Unknown device'
  const browser = /CriOS|Chrome/i.test(value)
    ? 'Chrome'
    : /Safari/i.test(value)
      ? 'Safari'
      : /Firefox/i.test(value)
        ? 'Firefox'
        : ''
  return [device, browser].filter(Boolean).join(' ')
}

export function summarizeBookingErrors(
  rows: BookingErrorRow[],
  now = new Date(),
): BookingErrorSummary {
  const sessions = new Set<string>()
  const unresolved = new Set<string>()
  const last24Cutoff = now.getTime() - 24 * 60 * 60 * 1000
  const stageGroups = new Map<
    BookingErrorStage,
    { events: number; sessions: Set<string> }
  >()
  let totalEvents = 0
  let last24Hours = 0
  let alertDeliveryFailures = 0

  for (const row of rows) {
    const occurrences = Math.max(1, Number(row.occurrence_count || 1))
    sessions.add(row.session_id)
    if (!row.recovered_at) unresolved.add(row.session_id)
    totalEvents += occurrences
    if (new Date(row.last_seen_at).getTime() >= last24Cutoff) {
      last24Hours += occurrences
    }
    if (row.alert_error) alertDeliveryFailures += 1
    const group = stageGroups.get(row.stage) || {
      events: 0,
      sessions: new Set<string>(),
    }
    group.events += occurrences
    group.sessions.add(row.session_id)
    stageGroups.set(row.stage, group)
  }

  return {
    totalEvents,
    affectedSessions: sessions.size,
    unresolvedSessions: unresolved.size,
    last24Hours,
    alertDeliveryFailures,
    byStage: BOOKING_ERROR_STAGES.map((stage) => ({
      stage,
      label: bookingErrorStageLabel(stage),
      events: stageGroups.get(stage)?.events || 0,
      sessions: stageGroups.get(stage)?.sessions.size || 0,
    })).filter((row) => row.events > 0),
    recent: [...rows]
      .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))
      .slice(0, 8)
      .map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        stage: row.stage,
        stageLabel: bookingErrorStageLabel(row.stage),
        errorMessage: row.error_message,
        httpStatus: row.http_status,
        quoteTotal: Number(row.quote_total || 0),
        itemCount: row.item_count,
        appointmentDate: row.appointment_date,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        customerEmail: row.customer_email,
        landingPath: row.landing_path,
        device: bookingErrorDeviceLabel(row.user_agent),
        occurrenceCount: row.occurrence_count,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        recoveredAt: row.recovered_at,
        alertSentAt: row.alert_sent_at,
        alertError: row.alert_error,
      })),
  }
}

export async function loadBookingErrorSummary(
  supabase: SupabaseClient,
  options?: { windowDays?: number },
): Promise<BookingErrorSummary> {
  const windowDays = options?.windowDays ?? 90
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('booking_error_events')
    .select(
      'id, session_id, stage, error_message, http_status, quote_total, item_count, appointment_date, customer_name, customer_phone, customer_email, landing_path, user_agent, occurrence_count, first_seen_at, last_seen_at, recovered_at, alert_sent_at, alert_error',
    )
    .gte('last_seen_at', since)
    .order('last_seen_at', { ascending: false })
    .limit(2000)
  if (error) throw error
  return summarizeBookingErrors((data || []) as BookingErrorRow[])
}
