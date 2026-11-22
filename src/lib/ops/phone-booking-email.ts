import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'
import { preparePhoneBookingEmail } from './communications'

type QueuePayload = {
  origin: 'phone_booking'
  date: string
  time: string
  total: number
  to: string
  firstAttempt?: string
  rendered?: NonNullable<Awaited<ReturnType<typeof preparePhoneBookingEmail>>>
}
type QueueRow = {
  id: string
  appointment_id: string
  customer_id: string
  scheduled_for: string
  payload: QueuePayload
}

async function deliver(db: SupabaseClient, row: QueueRow) {
  const queue = 'ops_communication_queue'
  const expires = new Date(Date.now() + 5 * 60_000).toISOString()
  const lease = await db
    .from(queue)
    .update({ scheduled_for: expires })
    .eq('id', row.id)
    .eq('status', 'pending')
    .eq('scheduled_for', row.scheduled_for)
    .select('id')
    .maybeSingle()
  if (lease.error) throw lease.error
  if (!lease.data) return
  async function update(changes: Record<string, unknown>) {
    const saved = await db
      .from(queue)
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'pending')
      .eq('scheduled_for', expires)
      .select('id')
      .single()
    if (saved.error) throw saved.error
  }

  const intent = row.payload
  if (
    intent.firstAttempt &&
    Date.now() - Date.parse(intent.firstAttempt) >= 23 * 3600_000
  ) {
    await update({
      status: 'failed',
      error_message:
        'Booking email delivery requires review. The safe retry period has ended.',
    })
    return
  }
  // Check the current customer and schedule even when recovering an ambiguous send.
  const current = await preparePhoneBookingEmail(db, row.appointment_id, intent)
  if (!current) {
    await update({
      status: 'cancelled',
      error_message: 'Booking, recipient, or email preference changed.',
    })
    return
  }
  const rendered = intent.rendered ?? current
  const firstAttempt = intent.firstAttempt ?? new Date().toISOString()
  if (!intent.rendered)
    await update({ payload: { ...intent, firstAttempt, rendered } })
  try {
    if (!process.env.RESEND_API_KEY)
      throw new Error('Booking email provider is not configured')
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send(
      rendered.message,
      {
        idempotencyKey: 'phone-booking-email/' + row.id,
      },
    )
    if (result.error || !result.data?.id)
      throw new Error(
        result.error?.message || 'Email provider returned no delivery ID',
      )
    const log = await db.from('ops_email_log').upsert(
      {
        id: row.id,
        appointment_id: row.appointment_id,
        customer_id: row.customer_id,
        template_key: 'job_scheduled_email',
        to_email: intent.to,
        subject: rendered.message.subject,
        resend_id: result.data.id,
        status: 'sent',
        body_text: rendered.body,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    if (log.error) throw log.error
    await update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      error_message: null,
    })
  } catch (error) {
    await update({
      error_message:
        error instanceof Error
          ? error.message
          : 'Booking email delivery needs retry.',
    })
    throw error
  }
}

/** Both the post-commit handler and cron may drain the same durable email intent. */
export async function deliverPhoneBookingEmails(
  db: SupabaseClient,
  appointmentId?: string,
) {
  let query = db
    .from('ops_communication_queue')
    .select('id,appointment_id,customer_id,scheduled_for,payload')
    .eq('status', 'pending')
    .eq('template_key', 'job_scheduled_email')
    .contains('payload', { origin: 'phone_booking' })
    .lte('scheduled_for', new Date().toISOString())
  if (appointmentId) query = query.eq('appointment_id', appointmentId)
  const rows = await query.order('scheduled_for').limit(5)
  if (rows.error) throw rows.error
  const outcomes = await Promise.allSettled(
    (rows.data as QueueRow[]).map((row) => deliver(db, row)),
  )
  const failure = outcomes.find((outcome) => outcome.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}
