/**
 * Customer-requested cleaning reminders.
 *
 * At job close-out Charles (admin invoice) or a tech (tech job screen) taps
 * 3 / 6 / 12 months. We text the customer an immediate confirmation and queue
 * the future reminder. A daily cron sends due rows inside a Mountain Time
 * window.
 *
 * This is opt-in and customer-initiated — it is deliberately separate from the
 * bulk reactivation campaign (which remains off). Guards: blacklist checked at
 * enqueue AND at send time, one live reminder per appointment, and a customer
 * who has already been serviced again before the reminder comes due gets it
 * cancelled automatically rather than nagged.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendCustomerSMSWithResult } from '@/lib/twilio'
import { isBlacklisted } from '@/lib/blacklist'
import { sendTelegramNotification } from '@/lib/telegram'

/**
 * Public booking page the reminder links to — the light NFC-style widget.
 *
 * Must be the sightings.* host: www.sasquatchcarpet.com is the separate
 * marketing site and 404s on this path. (curl reports 200 there because the
 * 404 page itself returns 200 — verify link changes in a real browser.)
 */
export const REBOOK_URL = 'https://sightings.sasquatchcarpet.com/rebook'
/** Tiered promo seeded in migration add_cleaning_reminders: $20 off $200+. */
export const REMINDER_PROMO_CODE = 'REMIND20'
export const REMINDER_PROMO_MIN_SPEND = 200

export const REMINDER_INTERVALS = [3, 6, 12] as const
export type ReminderInterval = (typeof REMINDER_INTERVALS)[number]

/** Send window in Mountain Time — outside it, due rows simply wait. */
const WINDOW_START_HOUR = 9
const WINDOW_END_HOUR = 19 // exclusive: last send 6:59pm
const SEND_BATCH_LIMIT = 25

export type ReminderCustomer = {
  id: string
  first_name: string | null
  full_name: string | null
  phone: string | null
}

export function isValidInterval(value: unknown): value is ReminderInterval {
  return REMINDER_INTERVALS.includes(Number(value) as ReminderInterval)
}

export function isWithinSendWindow(now: Date = new Date()): boolean {
  const hour = Number(
    now.toLocaleString('en-US', {
      timeZone: 'America/Denver',
      hour: 'numeric',
      hour12: false,
    }),
  )
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR
}

/**
 * Add whole months, clamping to the end of the target month so a Jan 31 close
 * plus 1 month lands on Feb 28, not Mar 3.
 */
export function addMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime())
  const targetDay = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const daysInTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate()
  result.setUTCDate(Math.min(targetDay, daysInTargetMonth))
  return result
}

/**
 * Reminders fire at 10am Mountain on the due date. The cron runs daily and
 * picks up anything due, so the exact minute only decides ordering.
 */
export function scheduledForInterval(
  months: ReminderInterval,
  from: Date = new Date(),
): Date {
  const due = addMonths(from, months)
  // 10am MT ≈ 16:00 UTC (MDT) / 17:00 UTC (MST). The send-window guard keeps
  // it inside business hours either way, so 16:00 UTC is a safe anchor.
  due.setUTCHours(16, 0, 0, 0)
  return due
}

function firstName(
  customer: Pick<ReminderCustomer, 'first_name' | 'full_name'>,
) {
  return (
    customer.first_name ||
    customer.full_name?.split(/\s+/)[0] ||
    ''
  ).trim()
}

export function formatDueMonth(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'long',
    year: 'numeric',
  })
}

/** Texted the moment the button is pressed, while we're still standing there. */
export function buildConfirmationMessage(
  customer: Pick<ReminderCustomer, 'first_name' | 'full_name'>,
  months: ReminderInterval,
  dueDate: Date,
): string {
  const first = firstName(customer)
  const greeting = first ? `Hi ${first}, it's` : "Hi, it's"
  return (
    `${greeting} Sasquatch Carpet Cleaning. You're all set — we'll text you a ` +
    `reminder in ${months} months (around ${formatDueMonth(dueDate)}) when it's ` +
    `time for your next cleaning. Thanks for having us out!`
  )
}

/** The actual reminder, months later. Must self-explain — they've forgotten. */
export function buildReminderMessage(
  customer: Pick<ReminderCustomer, 'first_name' | 'full_name'>,
  months: ReminderInterval,
  requestedAt: Date,
): string {
  const first = firstName(customer)
  const greeting = first ? `Hi ${first}, it's` : "Hi, it's"
  return (
    `${greeting} Sasquatch Carpet Cleaning. Back in ${formatDueMonth(requestedAt)} ` +
    `you asked us to remind you in ${months} months when it was time for another ` +
    `carpet cleaning — so here we are! Book here: ${REBOOK_URL} ` +
    `Use code ${REMINDER_PROMO_CODE} for $20 off jobs $${REMINDER_PROMO_MIN_SPEND}+.`
  )
}

export type SetReminderResult = {
  reminderId: string
  scheduledFor: string
  months: ReminderInterval
  confirmationSent: boolean
  confirmationError?: string
}

/**
 * Queue a reminder and immediately text the customer a confirmation.
 *
 * Re-tapping a different interval on the same appointment replaces the live
 * reminder rather than stacking a second one (mis-taps are expected — this is
 * pressed on a phone in the field).
 */
export async function setCleaningReminder(
  supabase: SupabaseClient,
  params: {
    appointmentId: string
    months: ReminderInterval
    createdBy?: string | null
    now?: Date
    sendSms?: (phone: string, message: string) => Promise<{ sid: string }>
  },
): Promise<SetReminderResult> {
  const now = params.now ?? new Date()
  const sendSms =
    params.sendSms ??
    ((phone: string, message: string) =>
      sendCustomerSMSWithResult(
        phone,
        message,
        undefined,
        'cleaning_reminder_confirmation',
      ))

  const { data: appointment, error: apptError } = await supabase
    .from('ops_appointments')
    .select('id, customer_id')
    .eq('id', params.appointmentId)
    .maybeSingle()
  if (apptError) throw apptError
  if (!appointment) throw new Error('Job not found')
  if (!appointment.customer_id)
    throw new Error('This job has no customer attached')

  // The invoice points at the appointment, not the reverse — stored for
  // reference only, so its absence must never block setting a reminder.
  const { data: invoice } = await supabase
    .from('ops_invoices')
    .select('id')
    .eq('appointment_id', appointment.id)
    .maybeSingle()

  const { data: customer, error: customerError } = await supabase
    .from('ops_customers')
    .select('id, first_name, full_name, phone')
    .eq('id', appointment.customer_id)
    .maybeSingle<ReminderCustomer>()
  if (customerError) throw customerError
  if (!customer?.phone)
    throw new Error('This customer has no phone number on file')

  if (await isBlacklisted(customer.phone)) {
    throw new Error('This number is on the do-not-contact list')
  }

  const scheduledFor = scheduledForInterval(params.months, now)

  // Replace any live reminder on this appointment (mis-tap / changed mind).
  await supabase
    .from('cleaning_reminders')
    .update({
      status: 'cancelled',
      skip_reason: 'replaced by a new reminder',
      updated_at: now.toISOString(),
    })
    .eq('appointment_id', params.appointmentId)
    .eq('status', 'pending')

  const { data: inserted, error: insertError } = await supabase
    .from('cleaning_reminders')
    .insert({
      customer_id: customer.id,
      appointment_id: appointment.id,
      invoice_id: invoice?.id ?? null,
      interval_months: params.months,
      phone: customer.phone,
      status: 'pending',
      scheduled_for: scheduledFor.toISOString(),
      created_by: params.createdBy ?? null,
    })
    .select('id')
    .single()
  if (insertError) throw insertError

  // The confirmation is a nicety; a failed text must not lose the reminder.
  let confirmationSent = false
  let confirmationError: string | undefined
  try {
    const result = await sendSms(
      customer.phone,
      buildConfirmationMessage(customer, params.months, scheduledFor),
    )
    confirmationSent = true
    await supabase
      .from('cleaning_reminders')
      .update({ confirmation_sid: result?.sid ?? null })
      .eq('id', inserted.id)
  } catch (error) {
    confirmationError =
      error instanceof Error ? error.message : 'Confirmation text failed'
    console.error('[cleaning-reminders] confirmation send failed:', error)
  }

  return {
    reminderId: inserted.id,
    scheduledFor: scheduledFor.toISOString(),
    months: params.months,
    confirmationSent,
    confirmationError,
  }
}

export async function cancelCleaningReminder(
  supabase: SupabaseClient,
  reminderId: string,
): Promise<void> {
  const { error } = await supabase
    .from('cleaning_reminders')
    .update({
      status: 'cancelled',
      skip_reason: 'cancelled by staff',
      updated_at: new Date().toISOString(),
    })
    .eq('id', reminderId)
    .eq('status', 'pending')
  if (error) throw error
}

export async function getReminderForAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
): Promise<{
  id: string
  interval_months: number
  scheduled_for: string
} | null> {
  const { data } = await supabase
    .from('cleaning_reminders')
    .select('id, interval_months, scheduled_for')
    .eq('appointment_id', appointmentId)
    .eq('status', 'pending')
    .maybeSingle()
  return data ?? null
}

/**
 * Send due reminders. Outside the Mountain Time window this is a no-op —
 * pending rows wait for the next run. `sendSms` is injectable so integration
 * tests never text real customers.
 */
export async function processDueCleaningReminders(
  supabase: SupabaseClient,
  options: {
    sendSms?: (phone: string, message: string) => Promise<unknown>
    notifyOwner?: (text: string) => Promise<unknown>
    now?: Date
  } = {},
): Promise<{
  sent: number
  failed: number
  skipped: number
  deferred: boolean
}> {
  const now = options.now ?? new Date()
  if (!isWithinSendWindow(now)) {
    return { sent: 0, failed: 0, skipped: 0, deferred: true }
  }

  const sendSms =
    options.sendSms ??
    ((phone: string, message: string) =>
      sendCustomerSMSWithResult(phone, message, undefined, 'cleaning_reminder'))
  const notifyOwner =
    options.notifyOwner ?? ((text: string) => sendTelegramNotification(text))

  const { data: due, error } = await supabase
    .from('cleaning_reminders')
    .select(
      'id, customer_id, phone, interval_months, created_at, scheduled_for',
    )
    .eq('status', 'pending')
    .lte('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(SEND_BATCH_LIMIT)
  if (error) throw error
  if (!due?.length) return { sent: 0, failed: 0, skipped: 0, deferred: false }

  let sent = 0
  let failed = 0
  let skipped = 0

  const markSkipped = async (id: string, reason: string) => {
    await supabase
      .from('cleaning_reminders')
      .update({
        status: 'skipped',
        skip_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    skipped += 1
  }

  for (const reminder of due) {
    const { data: customer } = await supabase
      .from('ops_customers')
      .select('id, first_name, full_name, phone')
      .eq('id', reminder.customer_id)
      .maybeSingle<ReminderCustomer>()

    const phone = customer?.phone || reminder.phone
    if (!phone) {
      await markSkipped(reminder.id, 'no phone at send time')
      continue
    }

    // Re-check — the list may have changed in the months since enqueue.
    if (await isBlacklisted(phone)) {
      await markSkipped(reminder.id, 'blacklisted at send time')
      continue
    }

    // If they've already been cleaned since asking, don't ask them to rebook.
    const { data: recentJob } = await supabase
      .from('ops_appointments')
      .select('id')
      .eq('customer_id', reminder.customer_id)
      .eq('status', 'completed')
      .gt('completed_at', reminder.created_at)
      .limit(1)
      .maybeSingle()
    if (recentJob) {
      await markSkipped(reminder.id, 'customer serviced again since requesting')
      continue
    }

    const message = buildReminderMessage(
      customer ?? { first_name: null, full_name: null },
      reminder.interval_months as ReminderInterval,
      new Date(reminder.created_at),
    )

    try {
      await sendSms(phone, message)
      await supabase
        .from('cleaning_reminders')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reminder.id)
      sent += 1
    } catch (sendError) {
      console.error(
        `[cleaning-reminders] send failed for reminder ${reminder.id}:`,
        sendError,
      )
      await supabase
        .from('cleaning_reminders')
        .update({
          status: 'failed',
          skip_reason:
            sendError instanceof Error ? sendError.message : 'send failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', reminder.id)
      failed += 1
    }
  }

  if (sent > 0) {
    await notifyOwner(
      `🗓️ Sent ${sent} cleaning reminder${sent === 1 ? '' : 's'} today` +
        (failed ? ` (${failed} failed)` : ''),
    )
  }

  return { sent, failed, skipped, deferred: false }
}
