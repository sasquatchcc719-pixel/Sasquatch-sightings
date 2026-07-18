import type { SupabaseClient } from '@supabase/supabase-js'
import { sendTelegramNotification } from '@/lib/telegram'

const ADMIN_BASE_URL = 'https://sightings.sasquatchcarpet.com'

// A technician is "actively on this job" while en route or working it. These
// are the same statuses the app uses to enforce one active job per tech.
const ACTIVE_JOB_STATUSES = ['on_my_way', 'in_progress']

type NotifyParams = {
  supabase: SupabaseClient
  customerId: string | null
  messageBody: string
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
    'Customer'
  )
}

/**
 * When a customer replies by SMS while a technician is actively en route to (or
 * working) their job, ping the shared team Telegram so the assigned tech — who
 * already watches that channel for payment alerts — sees the message right away
 * without Charles having to relay it by hand.
 *
 * Deliberately narrow: this only fires for a KNOWN ops customer who has an
 * appointment currently `on_my_way` or `in_progress`. A tech should only ever
 * hear from the job they're on the way to; every other inbound text stays in
 * Charles's existing relay untouched.
 *
 * Never throws — a failure here must not break the Twilio webhook response.
 */
export async function notifyActiveJobTechOfInboundSms({
  supabase,
  customerId,
  messageBody,
  mediaCount = 0,
}: NotifyParams): Promise<boolean> {
  try {
    if (!customerId) return false

    const { data: appts, error: apptError } = await supabase
      .from('ops_appointments')
      .select('id, status, on_my_way_at, assigned_staff_user_id')
      .eq('customer_id', customerId)
      .in('status', ACTIVE_JOB_STATUSES)
      .order('on_my_way_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .limit(1)

    if (apptError) throw apptError
    const appointment = appts?.[0]
    if (!appointment) return false // no active job — leave the tech alone

    // Resolve the assigned technician's name. The FK points at staff_users.id,
    // but we match user_id too for safety (mirrors resolveTechnicianEmailProfile).
    let techName = 'the assigned tech'
    if (appointment.assigned_staff_user_id) {
      const { data: staff } = await supabase
        .from('staff_users')
        .select('display_name')
        .or(
          `id.eq.${appointment.assigned_staff_user_id},user_id.eq.${appointment.assigned_staff_user_id}`,
        )
        .limit(1)
      if (staff?.[0]?.display_name) techName = staff[0].display_name as string
    }

    const { data: customer } = await supabase
      .from('ops_customers')
      .select('full_name, first_name, last_name, business_name')
      .eq('id', customerId)
      .maybeSingle()
    const customerName = resolveCustomerName(customer as CustomerNameRow | null)

    // Deep-link to the invoice for this job, falling back to the appointment.
    const { data: invoice } = await supabase
      .from('ops_invoices')
      .select('id')
      .eq('appointment_id', appointment.id)
      .maybeSingle()
    const link = invoice?.id
      ? `${ADMIN_BASE_URL}/admin/operations/invoices/${invoice.id}`
      : `${ADMIN_BASE_URL}/admin/operations/appointments/${appointment.id}`

    const trimmedBody = messageBody.trim()
    const bodyLine = trimmedBody
      ? `"${trimmedBody}"`
      : mediaCount > 0
        ? `(sent ${mediaCount} photo${mediaCount === 1 ? '' : 's'})`
        : '(no text)'
    const photoSuffix =
      trimmedBody && mediaCount > 0
        ? `\n📷 +${mediaCount} photo${mediaCount === 1 ? '' : 's'}`
        : ''

    const message =
      `📩 Reply from ${customerName} — ${techName} is en route\n` +
      `${bodyLine}${photoSuffix}\n` +
      `🧾 ${link}`

    return await sendTelegramNotification(message, { disablePreview: true })
  } catch (error) {
    console.error(
      '[active-job-tech-alert] Failed to notify tech of inbound SMS:',
      error,
    )
    return false
  }
}
