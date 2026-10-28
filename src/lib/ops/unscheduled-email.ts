import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

const mailbox = 'sasquatchcc719@gmail.com'
const gmailId = z.string().regex(/^[a-f0-9]{10,32}$/)
export const recordUnscheduledEmailInput = z
  .object({
    appointment_id: z.string().uuid(),
    message_id: gmailId,
    thread_id: gmailId,
    occurred_at: z.string().datetime({ offset: true }),
    from_email: z.string().trim().email().toLowerCase(),
    to_email: z.string().trim().email().toLowerCase(),
    subject: z.string().trim().min(1).max(1000),
    body_text: z.string().trim().min(1).max(20000),
  })
  .strict()

/** Import original Gmail evidence; never fetch, send, or fabricate a conversation message. */
export async function recordUnscheduledEmail(
  db: SupabaseClient,
  value: z.infer<typeof recordUnscheduledEmailInput>,
  actorId: string,
  actorLabel: string,
) {
  const input = recordUnscheduledEmailInput.parse(value)
  if (Date.parse(input.occurred_at) > Date.now())
    throw new Error('Email timestamp cannot be in the future')
  const { data: job, error } = await db
    .from('ops_appointments')
    .select(
      'customer_id, customer:ops_customers!ops_appointments_customer_id_fkey(email)',
    )
    .eq('id', input.appointment_id)
    .not('parked_at', 'is', null)
    .maybeSingle()
  if (error) throw error
  if (!job) throw new Error('Unscheduled appointment not found')
  const customer = Array.isArray(job.customer) ? job.customer[0] : job.customer
  const email = customer?.email?.trim().toLowerCase()
  const direction =
    input.from_email === mailbox && input.to_email === email
      ? 'outbound'
      : input.to_email === mailbox && input.from_email === email
        ? 'inbound'
        : null
  if (!direction || email === mailbox)
    throw new Error(
      'Email must be between the saved customer address and the business mailbox',
    )
  const { appointment_id: _appointmentId, ...message } = input
  const row = { ...message, mailbox, customer_id: job.customer_id, direction }
  const { error: insertError } = await db
    .from('ops_customer_email_history')
    .upsert(
      {
        ...row,
        recorded_by: actorId,
        recorded_by_label: actorLabel,
      },
      { onConflict: 'mailbox,message_id', ignoreDuplicates: true },
    )
  if (insertError) throw insertError
  // Repeated imports are safe; a provider ID cannot silently replace another message.
  const { data: saved, error: readError } = await db
    .from('ops_customer_email_history')
    .select('*')
    .eq('mailbox', mailbox)
    .eq('message_id', input.message_id)
    .single()
  if (readError) throw readError
  if (
    !saved ||
    Object.entries(row).some(([key, value]) =>
      key === 'occurred_at'
        ? Date.parse(saved[key]) !== Date.parse(String(value))
        : saved[key] !== value,
    )
  )
    throw new Error(
      'This Gmail message ID is already recorded with different evidence',
    )
  return {
    id: saved.id as string,
    direction,
    effect:
      'Email evidence recorded only; no message sent and no follow-up plan changed.',
  }
}
