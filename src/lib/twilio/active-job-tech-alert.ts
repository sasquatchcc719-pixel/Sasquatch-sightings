import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendOneSignalToExternalIds } from '@/lib/onesignal'

const DEFAULT_ORIGIN = 'https://sightings.sasquatchcarpet.com'

// A technician is "actively on this job" while en route or working it. These
// are the same statuses the app uses to enforce one active job per tech.
const ACTIVE_JOB_STATUSES = ['on_my_way', 'in_progress']

function appOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    DEFAULT_ORIGIN
  ).replace(/\/+$/, '')
}

// Stable UUID derived from the Twilio SID so OneSignal suppresses duplicate
// deliveries if the push request is retried.
function inboundPushIdempotencyKey(twilioSid: string): string {
  const bytes = createHash('sha256')
    .update(`inbound-sms-tech-push:${twilioSid}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

type NotifyParams = {
  supabase: SupabaseClient
  customerId: string | null
  messageBody: string
  twilioSid: string
  mediaCount?: number
}

type CustomerNameRow = {
  full_name: string | null
  first_name: string | null
  last_name: string | null
  business_name: string | null
}

function resolveCustomerName(customer: CustomerNameRow | null): string {
  return (
    customer?.full_name?.trim() ||
    [customer?.first_name, customer?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    customer?.business_name?.trim() ||
    'Your customer'
  )
}

/**
 * When a customer replies by SMS while a technician is actively en route to (or
 * working) their job, send a push straight to THAT technician's phone so they
 * see it (e.g. building-access directions) without Charles having to relay it.
 *
 * Delivery is via OneSignal to the assigned tech's Sightings user_id — the same
 * per-device channel their Square payment pushes use. (The `TELEGRAM_CHAT_ID`
 * alert channel goes only to the owner's personal chat, so it can't reach a
 * tech.) Charles keeps his existing per-customer Telegram relay untouched.
 *
 * Deliberately narrow: only fires for a KNOWN customer who has an appointment
 * currently `on_my_way`/`in_progress`, and only pushes to that job's assigned
 * tech. A tech only ever hears from the job they're on the way to.
 *
 * Never throws — a failure here must not break the Twilio webhook response.
 */
export async function notifyActiveJobTechOfInboundSms({
  supabase,
  customerId,
  messageBody,
  twilioSid,
  mediaCount = 0,
}: NotifyParams): Promise<boolean> {
  try {
    if (!customerId) return false

    const { data: appts, error: apptError } = await supabase
      .from('ops_appointments')
      .select('id, on_my_way_at, assigned_staff_user_id')
      .eq('customer_id', customerId)
      .in('status', ACTIVE_JOB_STATUSES)
      .order('on_my_way_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .limit(1)

    if (apptError) throw apptError
    const appointment = appts?.[0]
    if (!appointment?.assigned_staff_user_id) return false // no active tech

    // Resolve the assigned tech to their auth user_id (OneSignal external_id).
    // assigned_staff_user_id is a staff_users.id; match user_id too for safety.
    const { data: staff } = await supabase
      .from('staff_users')
      .select('user_id')
      .or(
        `id.eq.${appointment.assigned_staff_user_id},user_id.eq.${appointment.assigned_staff_user_id}`,
      )
      .limit(1)
      .maybeSingle()
    const techUserId = (staff?.user_id as string | null | undefined) || null
    if (!techUserId) return false

    const { data: customer } = await supabase
      .from('ops_customers')
      .select('full_name, first_name, last_name, business_name')
      .eq('id', customerId)
      .maybeSingle()
    const customerName = resolveCustomerName(customer as CustomerNameRow | null)

    const trimmedBody = messageBody.trim()
    let content: string
    if (trimmedBody) {
      const clipped =
        trimmedBody.length > 160 ? `${trimmedBody.slice(0, 157)}…` : trimmedBody
      content = `${customerName}: ${clipped}`
    } else if (mediaCount > 0) {
      content = `${customerName} sent ${mediaCount} photo${mediaCount === 1 ? '' : 's'}`
    } else {
      content = `${customerName} sent a message`
    }

    const result = await sendOneSignalToExternalIds({
      externalIds: [techUserId],
      heading: 'New text from your customer',
      content,
      data: {
        type: 'inbound_customer_sms',
        appointment_id: appointment.id,
        customer_id: customerId,
      },
      idempotencyKey: inboundPushIdempotencyKey(twilioSid),
      url: `${appOrigin()}/tech/jobs/${appointment.id}`,
    })

    return Boolean(result)
  } catch (error) {
    console.error(
      '[active-job-tech-alert] Failed to notify tech of inbound SMS:',
      error,
    )
    return false
  }
}
