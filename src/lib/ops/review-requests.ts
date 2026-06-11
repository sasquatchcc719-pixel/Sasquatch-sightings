/**
 * Post-job Google review request engine.
 *
 * Cron-driven, no hooks into completion paths: every run scans recently
 * completed appointments (any completion path — Telegram, admin UI, GPS),
 * queues one review-ask SMS per appointment, and sends due requests inside a
 * Mountain Time window. Guards: residential only, one ask per customer per
 * cooldown period, blacklist-checked at enqueue AND send time.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendCustomerSMSWithResult } from '@/lib/twilio'
import { isBlacklisted } from '@/lib/blacklist'
import { sendToCharles } from '@/lib/harry-command-bot'

// Sasquatch Carpet Cleaning, LLC GBP listing (Place ID verified via SerpApi
// 2026-06-11: 740 Platte Ln, Palmer Lake — 4.9★, 69 reviews at launch).
export const GOOGLE_REVIEW_URL =
  process.env.GOOGLE_REVIEW_URL ||
  'https://search.google.com/local/writereview?placeid=ChIJw1Fmyv9_EQIRSsL80280NoQ'

/** How long after completion before the ask goes out. */
const ASK_DELAY_MINUTES = 90
/** Only completions newer than this are considered (keeps asks fresh). */
const LOOKBACK_HOURS = 48
/** Never ask the same customer twice within this window. */
const COOLDOWN_DAYS = 180
/** Send window in Mountain Time — outside it, due requests simply wait. */
const WINDOW_START_HOUR = 9
const WINDOW_END_HOUR = 19 // exclusive: last send 6:59pm
const SEND_BATCH_LIMIT = 10

type ReviewCustomer = {
  id: string
  first_name: string | null
  full_name: string | null
  business_name: string | null
  phone: string | null
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

export function buildReviewRequestMessage(
  customer: Pick<ReviewCustomer, 'first_name' | 'full_name'>,
): string {
  const first = (
    customer.first_name ||
    customer.full_name?.split(/\s+/)[0] ||
    ''
  ).trim()
  const greeting = first ? `Hi ${first}, it's` : "Hi, it's"
  return (
    `${greeting} Charles with Sasquatch Carpet Cleaning. Thanks for having us out! ` +
    `If you were happy with your clean, a quick Google review makes a huge difference ` +
    `for our small local business: ${GOOGLE_REVIEW_URL}`
  )
}

/**
 * Queue review requests for recently completed appointments that don't have
 * one yet. Ineligible appointments get a `skipped` row (so they are never
 * re-examined) with the reason recorded.
 */
export async function enqueueReviewRequests(
  supabase: SupabaseClient,
): Promise<{ queued: number; skipped: number }> {
  const lookbackIso = new Date(
    Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString()

  const { data: completed, error } = await supabase
    .from('ops_appointments')
    .select('id, customer_id, completed_at')
    .eq('status', 'completed')
    .gte('completed_at', lookbackIso)
    .order('completed_at', { ascending: true })
  if (error) throw error
  if (!completed?.length) return { queued: 0, skipped: 0 }

  const { data: existing } = await supabase
    .from('review_requests')
    .select('appointment_id')
    .in(
      'appointment_id',
      completed.map((a) => a.id),
    )
  const alreadyQueued = new Set((existing || []).map((r) => r.appointment_id))

  let queued = 0
  let skipped = 0

  for (const appt of completed) {
    if (alreadyQueued.has(appt.id)) continue

    const insertSkip = async (reason: string) => {
      await supabase.from('review_requests').insert({
        appointment_id: appt.id,
        customer_id: appt.customer_id,
        status: 'skipped',
        skip_reason: reason,
        scheduled_for: new Date().toISOString(),
      })
      skipped += 1
    }

    if (!appt.customer_id) {
      await insertSkip('no customer on appointment')
      continue
    }

    const { data: customer } = await supabase
      .from('ops_customers')
      .select('id, first_name, full_name, business_name, phone')
      .eq('id', appt.customer_id)
      .maybeSingle<ReviewCustomer>()

    if (!customer?.phone) {
      await insertSkip('customer has no phone number')
      continue
    }
    if (customer.business_name?.trim()) {
      await insertSkip('commercial customer')
      continue
    }
    if (await isBlacklisted(customer.phone)) {
      await insertSkip('blacklisted')
      continue
    }

    // One ask per customer per cooldown window (counts pending + sent).
    const cooldownIso = new Date(
      Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString()
    const { data: recentAsk } = await supabase
      .from('review_requests')
      .select('id')
      .eq('customer_id', customer.id)
      .in('status', ['pending', 'sent'])
      .gte('created_at', cooldownIso)
      .limit(1)
      .maybeSingle()
    if (recentAsk) {
      await insertSkip(`asked within last ${COOLDOWN_DAYS} days`)
      continue
    }

    const completedAtMs = Date.parse(String(appt.completed_at))
    const scheduledFor = new Date(
      (Number.isFinite(completedAtMs) ? completedAtMs : Date.now()) +
        ASK_DELAY_MINUTES * 60 * 1000,
    ).toISOString()

    const { error: insertError } = await supabase
      .from('review_requests')
      .insert({
        appointment_id: appt.id,
        customer_id: customer.id,
        phone: customer.phone,
        status: 'pending',
        scheduled_for: scheduledFor,
      })
    if (insertError) {
      console.error(
        `[review-requests] enqueue failed for appointment ${appt.id}:`,
        insertError,
      )
      continue
    }
    queued += 1
  }

  return { queued, skipped }
}

/**
 * Send due review requests. Outside the Mountain Time window this is a no-op —
 * pending rows simply wait for the next cron run inside the window.
 * `sendSms` is injectable so integration tests never text real customers.
 */
export async function processDueReviewRequests(
  supabase: SupabaseClient,
  options: {
    sendSms?: (phone: string, message: string) => Promise<unknown>
    notifyOwner?: (text: string) => Promise<unknown>
    now?: Date
  } = {},
): Promise<{ sent: number; failed: number; deferred: boolean }> {
  const now = options.now ?? new Date()
  if (!isWithinSendWindow(now)) {
    return { sent: 0, failed: 0, deferred: true }
  }

  const sendSms =
    options.sendSms ??
    ((phone: string, message: string) =>
      sendCustomerSMSWithResult(phone, message, undefined, 'review_request'))
  const notifyOwner =
    options.notifyOwner ?? ((text: string) => sendToCharles(text))

  const { data: due, error } = await supabase
    .from('review_requests')
    .select('id, customer_id, phone')
    .eq('status', 'pending')
    .lte('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(SEND_BATCH_LIMIT)
  if (error) throw error
  if (!due?.length) return { sent: 0, failed: 0, deferred: false }

  let sent = 0
  let failed = 0

  for (const request of due) {
    const { data: customer } = await supabase
      .from('ops_customers')
      .select('id, first_name, full_name, business_name, phone')
      .eq('id', request.customer_id)
      .maybeSingle<ReviewCustomer>()

    const phone = customer?.phone || request.phone
    if (!phone) {
      await supabase
        .from('review_requests')
        .update({
          status: 'skipped',
          skip_reason: 'no phone at send time',
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.id)
      continue
    }

    // Re-check at send time — blacklist may have changed since enqueue.
    if (await isBlacklisted(phone)) {
      await supabase
        .from('review_requests')
        .update({
          status: 'skipped',
          skip_reason: 'blacklisted at send time',
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.id)
      continue
    }

    const message = buildReviewRequestMessage(
      customer ?? {
        first_name: null,
        full_name: null,
      },
    )

    try {
      await sendSms(phone, message)
      await supabase
        .from('review_requests')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          phone,
          message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.id)
      sent += 1
      const label = customer?.full_name || customer?.first_name || phone
      notifyOwner(
        `⭐ Review request sent to ${label} (${phone}) after their completed job.`,
      ).catch((err) =>
        console.error('[review-requests] owner notify failed:', err),
      )
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      console.error(
        `[review-requests] send failed for request ${request.id}:`,
        err,
      )
      await supabase
        .from('review_requests')
        .update({
          status: 'failed',
          skip_reason: detail.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.id)
      failed += 1
    }
  }

  return { sent, failed, deferred: false }
}
