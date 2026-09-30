/**
 * Post-job backup for the invoice cleaning-reminder buttons.
 *
 * Staff still get the first chance to set 3 / 6 / 12 months at close-out. If
 * they do not, this engine asks the customer in a separate SMS at least 30
 * minutes after the review request. No reply means no reminder.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isBlacklisted } from '@/lib/blacklist'
import { opsPhoneLookupVariants } from '@/lib/ops/phone'
import { isWarrantyAppointment } from '@/lib/ops/warranty-appointment'
import { sendCustomerSMSWithResult } from '@/lib/twilio'
import {
  isWithinSendWindow,
  setCleaningReminder,
  type ReminderCustomer,
  type ReminderInterval,
} from '@/lib/ops/cleaning-reminders'

export const CLEANING_REMINDER_PROMPT_DELAY_MINUTES = 30
const LOOKBACK_HOURS = 48
const REPLY_WINDOW_DAYS = 7
const SEND_BATCH_LIMIT = 10

type PromptCustomer = ReminderCustomer & {
  business_name: string | null
}

export type CleaningReminderPromptReply =
  | { kind: 'interval'; months: ReminderInterval }
  | { kind: 'decline' }

function firstName(
  customer: Pick<ReminderCustomer, 'first_name' | 'full_name'>,
): string {
  return (
    customer.first_name ||
    customer.full_name?.split(/\s+/)[0] ||
    ''
  ).trim()
}

export function buildCleaningReminderPromptMessage(
  customer: Pick<ReminderCustomer, 'first_name' | 'full_name'>,
): string {
  const first = firstName(customer)
  const greeting = first
    ? `Hi ${first}, one quick question:`
    : 'One quick question:'
  return (
    `${greeting} would you like us to remind you when it may be time for another ` +
    `cleaning? This is only a reminder - no appointment will be booked, and ` +
    `there is absolutely no obligation to schedule. Reply 3, 6, or 12 for the ` +
    `number of months, or NO THANKS for no reminder.`
  )
}

export function buildCleaningReminderDeclinedMessage(): string {
  return 'No problem - no cleaning reminder has been set.'
}

export function parseCleaningReminderPromptReply(
  message: string,
): CleaningReminderPromptReply | null {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^please\s+|\s+please$/g, '')

  if (
    [
      'no',
      'no thanks',
      'no thank you',
      'none',
      'not now',
      'no reminder',
      "don't remind me",
      'do not remind me',
    ].includes(normalized)
  ) {
    return { kind: 'decline' }
  }

  const intervals: Array<[ReminderInterval, string[]]> = [
    [3, ['3', '3 month', '3 months', 'three', 'three month', 'three months']],
    [6, ['6', '6 month', '6 months', 'six', 'six month', 'six months']],
    [
      12,
      [
        '12',
        '12 month',
        '12 months',
        'twelve',
        'twelve month',
        'twelve months',
        '1 year',
        'one year',
        'a year',
      ],
    ],
  ]
  for (const [months, replies] of intervals) {
    if (replies.includes(normalized)) return { kind: 'interval', months }
  }
  return null
}

export function cleaningReminderPromptTime(anchor: string | Date): Date {
  const anchorMs =
    anchor instanceof Date ? anchor.getTime() : Date.parse(String(anchor))
  const base = Number.isFinite(anchorMs) ? anchorMs : Date.now()
  return new Date(base + CLEANING_REMINDER_PROMPT_DELAY_MINUTES * 60_000)
}

function promptTime(completedAt: string): string {
  return cleaningReminderPromptTime(completedAt).toISOString()
}

export function cleaningReminderPromptReviewWait(
  reviewRequest: { status: string; sent_at: string | null } | null,
  now: Date,
): Date | null {
  if (reviewRequest?.status === 'pending') {
    return new Date(now.getTime() + 5 * 60_000)
  }
  if (reviewRequest?.status !== 'sent' || !reviewRequest.sent_at) return null

  const earliestSend = cleaningReminderPromptTime(reviewRequest.sent_at)
  return earliestSend > now ? earliestSend : null
}

/** Queue one durable prompt decision for each newly completed appointment. */
export async function enqueueCleaningReminderPrompts(
  supabase: SupabaseClient,
): Promise<{ queued: number; skipped: number }> {
  const lookbackIso = new Date(
    Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString()
  const { data: completed, error } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      customer_id,
      completed_at,
      kind,
      visit_type,
      service_concern_id,
      ops_appointment_line_items (
        name_snapshot,
        service_catalog_items (slug)
      )
    `,
    )
    .eq('status', 'completed')
    .gte('completed_at', lookbackIso)
    .order('completed_at', { ascending: true })
  if (error) throw error
  if (!completed?.length) return { queued: 0, skipped: 0 }

  const appointmentIds = completed.map((appointment) => appointment.id)
  const [{ data: existingPrompts }, { data: existingReminders }] =
    await Promise.all([
      supabase
        .from('cleaning_reminder_prompts')
        .select('appointment_id')
        .in('appointment_id', appointmentIds),
      supabase
        .from('cleaning_reminders')
        .select('appointment_id')
        .in('appointment_id', appointmentIds)
        .eq('status', 'pending'),
    ])
  const alreadyConsidered = new Set(
    (existingPrompts || []).map((row) => row.appointment_id),
  )
  const staffSetReminder = new Set(
    (existingReminders || []).map((row) => row.appointment_id),
  )

  let queued = 0
  let skipped = 0

  for (const appointment of completed) {
    if (alreadyConsidered.has(appointment.id)) continue

    const insertSkipped = async (reason: string) => {
      const { error: insertError } = await supabase
        .from('cleaning_reminder_prompts')
        .insert({
          appointment_id: appointment.id,
          customer_id: appointment.customer_id,
          status: 'skipped',
          skip_reason: reason,
          scheduled_for: promptTime(String(appointment.completed_at)),
        })
      if (insertError) {
        console.error(
          `[cleaning-reminder-prompts] skip insert failed for ${appointment.id}:`,
          insertError,
        )
        return
      }
      skipped += 1
    }

    if (!appointment.customer_id) {
      await insertSkipped('no customer on appointment')
      continue
    }
    if (appointment.kind !== 'service') {
      await insertSkipped('not a residential service job')
      continue
    }
    if (isWarrantyAppointment(appointment)) {
      await insertSkipped('warranty follow-up')
      continue
    }
    if (staffSetReminder.has(appointment.id)) {
      await insertSkipped('reminder already set from invoice')
      continue
    }

    const { data: customer } = await supabase
      .from('ops_customers')
      .select('id, first_name, full_name, business_name, phone')
      .eq('id', appointment.customer_id)
      .maybeSingle<PromptCustomer>()
    if (!customer?.phone) {
      await insertSkipped('customer has no phone number')
      continue
    }
    if (customer.business_name?.trim()) {
      await insertSkipped('commercial customer')
      continue
    }
    if (await isBlacklisted(customer.phone)) {
      await insertSkipped('blacklisted')
      continue
    }

    const { error: insertError } = await supabase
      .from('cleaning_reminder_prompts')
      .insert({
        appointment_id: appointment.id,
        customer_id: customer.id,
        phone: customer.phone,
        status: 'pending',
        scheduled_for: promptTime(String(appointment.completed_at)),
      })
    if (insertError) {
      console.error(
        `[cleaning-reminder-prompts] enqueue failed for ${appointment.id}:`,
        insertError,
      )
      continue
    }
    queued += 1
  }

  return { queued, skipped }
}

/** Send due prompts, preserving at least 30 minutes after a sent review ask. */
export async function processDueCleaningReminderPrompts(
  supabase: SupabaseClient,
  options: {
    now?: Date
    sendSms?: (
      phone: string,
      message: string,
      customerId: string,
    ) => Promise<unknown>
  } = {},
): Promise<{
  sent: number
  failed: number
  skipped: number
  waiting: number
  deferred: boolean
}> {
  const now = options.now ?? new Date()
  if (!isWithinSendWindow(now)) {
    return { sent: 0, failed: 0, skipped: 0, waiting: 0, deferred: true }
  }
  const sendSms =
    options.sendSms ??
    ((phone: string, message: string, customerId: string) =>
      sendCustomerSMSWithResult(
        phone,
        message,
        undefined,
        'cleaning_reminder_prompt',
        undefined,
        { customerId },
      ))

  const { data: due, error } = await supabase
    .from('cleaning_reminder_prompts')
    .select('id, appointment_id, customer_id, phone')
    .eq('status', 'pending')
    .lte('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(SEND_BATCH_LIMIT)
  if (error) throw error
  if (!due?.length) {
    return { sent: 0, failed: 0, skipped: 0, waiting: 0, deferred: false }
  }

  let sent = 0
  let failed = 0
  let skipped = 0
  let waiting = 0

  const updatePrompt = async (id: string, values: Record<string, unknown>) => {
    await supabase
      .from('cleaning_reminder_prompts')
      .update({ ...values, updated_at: now.toISOString() })
      .eq('id', id)
  }
  const markSkipped = async (id: string, reason: string) => {
    await updatePrompt(id, { status: 'skipped', skip_reason: reason })
    skipped += 1
  }

  for (const prompt of due) {
    const { data: reminder } = await supabase
      .from('cleaning_reminders')
      .select('id')
      .eq('appointment_id', prompt.appointment_id)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle()
    if (reminder) {
      await markSkipped(prompt.id, 'reminder set before backup text')
      continue
    }

    const { data: reviewRequest } = await supabase
      .from('review_requests')
      .select('status, sent_at')
      .eq('appointment_id', prompt.appointment_id)
      .maybeSingle()
    const waitUntil = cleaningReminderPromptReviewWait(reviewRequest, now)
    if (waitUntil) {
      await updatePrompt(prompt.id, {
        scheduled_for: waitUntil.toISOString(),
      })
      waiting += 1
      continue
    }

    const { data: customer } = await supabase
      .from('ops_customers')
      .select('id, first_name, full_name, business_name, phone')
      .eq('id', prompt.customer_id)
      .maybeSingle<PromptCustomer>()
    const phone = customer?.phone || prompt.phone
    if (!customer || !phone) {
      await markSkipped(prompt.id, 'no phone at send time')
      continue
    }
    if (customer.business_name?.trim()) {
      await markSkipped(prompt.id, 'commercial customer at send time')
      continue
    }
    if (await isBlacklisted(phone)) {
      await markSkipped(prompt.id, 'blacklisted at send time')
      continue
    }

    const message = buildCleaningReminderPromptMessage(customer)
    try {
      await sendSms(phone, message, customer.id)
      await updatePrompt(prompt.id, {
        status: 'sent',
        sent_at: now.toISOString(),
        phone,
        message,
      })
      sent += 1
    } catch (sendError) {
      await updatePrompt(prompt.id, {
        status: 'failed',
        skip_reason:
          sendError instanceof Error ? sendError.message : 'send failed',
      })
      failed += 1
    }
  }

  return { sent, failed, skipped, waiting, deferred: false }
}

/** Turn a recent customer's exact reply into a reminder or a recorded decline. */
export async function handleCleaningReminderPromptReply(
  supabase: SupabaseClient,
  params: {
    phone: string
    message: string
    inboundMessageSid: string
    fromNumber?: string | null
    now?: Date
  },
): Promise<{ handled: boolean; outcome?: 'accepted' | 'declined' }> {
  const choice = parseCleaningReminderPromptReply(params.message)
  if (!choice) return { handled: false }

  const now = params.now ?? new Date()
  const variants = opsPhoneLookupVariants(params.phone)
  if (variants.length === 0) return { handled: false }
  const replyCutoff = new Date(
    now.getTime() - REPLY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  const { data: prompt, error } = await supabase
    .from('cleaning_reminder_prompts')
    .select('id, appointment_id, customer_id, phone')
    .in('phone', variants)
    .eq('status', 'sent')
    .gte('sent_at', replyCutoff)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!prompt) return { handled: false }

  if (choice.kind === 'decline') {
    const { error: updateError } = await supabase
      .from('cleaning_reminder_prompts')
      .update({
        status: 'declined',
        responded_at: now.toISOString(),
        inbound_message_sid: params.inboundMessageSid,
        response_text: params.message,
        updated_at: now.toISOString(),
      })
      .eq('id', prompt.id)
      .eq('status', 'sent')
    if (updateError) throw updateError
    await sendCustomerSMSWithResult(
      prompt.phone || params.phone,
      buildCleaningReminderDeclinedMessage(),
      undefined,
      'cleaning_reminder_declined',
      params.fromNumber || undefined,
      { customerId: prompt.customer_id },
    )
    return { handled: true, outcome: 'declined' }
  }

  await setCleaningReminder(supabase, {
    appointmentId: prompt.appointment_id,
    months: choice.months,
    source: 'customer_sms',
    now,
    sendSms: (phone, message) =>
      sendCustomerSMSWithResult(
        phone,
        message,
        undefined,
        'cleaning_reminder_confirmation',
        params.fromNumber || undefined,
        { customerId: prompt.customer_id },
      ),
  })
  const { error: updateError } = await supabase
    .from('cleaning_reminder_prompts')
    .update({
      status: 'accepted',
      responded_at: now.toISOString(),
      selected_interval_months: choice.months,
      inbound_message_sid: params.inboundMessageSid,
      response_text: params.message,
      updated_at: now.toISOString(),
    })
    .eq('id', prompt.id)
    .eq('status', 'sent')
  if (updateError) throw updateError
  return { handled: true, outcome: 'accepted' }
}
