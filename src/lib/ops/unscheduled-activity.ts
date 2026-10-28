import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/blacklist'

export type UnscheduledActivity = {
  id: string
  at: string | null
  title: string
  detail: string | null
  actor: string | null
  next_date?: string
  next_time?: string | null
}

/** Read existing evidence only; opening a card never records a contact attempt. */
export async function loadUnscheduledActivity(
  db: SupabaseClient,
  appointmentId: string,
) {
  const { data: job, error } = await db
    .from('ops_appointments')
    .select(
      'customer_id, parked_at, customer:ops_customers!ops_appointments_customer_id_fkey(phone)',
    )
    .eq('id', appointmentId)
    .not('parked_at', 'is', null)
    .maybeSingle()
  if (error) throw error
  if (!job) throw new Error('Unscheduled appointment not found')
  const customer = Array.isArray(job.customer) ? job.customer[0] : job.customer
  const phone = normalizePhone(customer?.phone ?? '')
  // Only canonical numeric phone variants enter PostgREST filter syntax.
  const phones = /^\d{10}$/.test(phone)
    ? [phone, `1${phone}`, `+1${phone}`]
    : []
  const match = (column: string, customerColumn: string) =>
    `${customerColumn}.eq.${job.customer_id}${phones.length ? `,and(${customerColumn}.is.null,${column}.in.(${phones.join(',')}))` : ''}`
  const [history, sms, conversations, calls, emails] = await Promise.all([
    db
      .from('ops_unscheduled_follow_up_events')
      .select(
        'id, occurred_at, event_type, note, next_follow_up_date, next_follow_up_time, actor_label',
      )
      .eq('appointment_id', appointmentId)
      .order('occurred_at', { ascending: false })
      .limit(100),
    db
      .from('sms_logs')
      .select(
        'id, sent_at, created_at, status, message_content, sent_by, twilio_sid',
      )
      .or(match('recipient_phone', 'customer_id'))
      .order('created_at', { ascending: false })
      .limit(100),
    db
      .from('conversations')
      .select('id, messages')
      .or(match('phone_number', 'ops_customer_id'))
      .order('updated_at', { ascending: false })
      .limit(20),
    phones.length
      ? db
          .from('call_logs')
          .select('id, created_at, direction, outcome, duration_seconds')
          .in('caller_phone', phones)
          .order('created_at', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    db
      .from('ops_email_log')
      .select('id, sent_at, status, subject, error_message')
      .eq('customer_id', job.customer_id)
      .order('sent_at', { ascending: false })
      .limit(100),
  ])
  for (const result of [history, sms, conversations, calls, emails]) {
    if (result.error) throw result.error
  }
  const events: UnscheduledActivity[] = [
    {
      id: `parked:${appointmentId}`,
      at: job.parked_at,
      title: 'Moved to Unscheduled',
      detail: null,
      actor: null,
    },
  ]
  for (const row of history.data ?? [])
    events.push({
      id: `review:${row.id}`,
      at: row.occurred_at,
      title:
        (
          {
            review: 'Follow-up review recorded',
            plan: 'Follow-up plan saved',
            resolved: 'Follow-up closed',
            reopened: 'Follow-up reopened',
          } as Record<string, string>
        )[row.event_type] || 'Follow-up updated',
      detail: row.note,
      actor: row.actor_label,
      next_date: row.next_follow_up_date,
      next_time: row.next_follow_up_time?.slice(0, 5) ?? null,
    })
  const providerIds = new Set<string>()
  for (const row of sms.data ?? []) {
    if (row.twilio_sid) providerIds.add(row.twilio_sid)
    events.push({
      id: `sms:${row.id}`,
      at: row.sent_at || row.created_at,
      title: `Outgoing text · ${row.status || 'status unknown'}`,
      detail: row.message_content,
      actor: row.sent_by || null,
    })
  }
  for (const conversation of conversations.data ?? []) {
    const messages: unknown[] = Array.isArray(conversation.messages)
      ? conversation.messages
      : []
    messages.forEach((value, index) => {
      if (!value || typeof value !== 'object') return
      const row = value as Record<string, unknown>
      if (row.role !== 'user' && row.role !== 'assistant') return
      if (typeof row.twilio_sid === 'string' && providerIds.has(row.twilio_sid))
        return
      if (typeof row.twilio_sid === 'string') providerIds.add(row.twilio_sid)
      events.push({
        id: `message:${conversation.id}:${index}`,
        at:
          typeof row.timestamp === 'string' &&
          Number.isFinite(Date.parse(row.timestamp))
            ? row.timestamp
            : null,
        title:
          row.role === 'user'
            ? 'Customer message received'
            : 'Outgoing message recorded',
        detail: typeof row.content === 'string' ? row.content : null,
        actor: typeof row.sent_by === 'string' ? row.sent_by : null,
      })
    })
  }
  for (const row of calls.data ?? [])
    events.push({
      id: `call:${row.id}`,
      at: row.created_at,
      title: `${row.direction === 'outbound' ? 'Outgoing' : row.direction === 'inbound' ? 'Incoming' : 'Recorded'} call · ${row.outcome || 'outcome unknown'}`,
      detail:
        row.duration_seconds == null
          ? null
          : `Recorded duration: ${row.duration_seconds} seconds`,
      actor: 'Matched by customer phone',
    })
  for (const row of emails.data ?? [])
    events.push({
      id: `email:${row.id}`,
      at: row.sent_at,
      title: `Outgoing email · ${row.status || 'status unknown'}`,
      detail: [row.subject, row.error_message].filter(Boolean).join(' · '),
      actor: null,
    })
  events.sort(
    (a, b) => (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0),
  )
  return { events: events.slice(0, 100), limit: 100 }
}
