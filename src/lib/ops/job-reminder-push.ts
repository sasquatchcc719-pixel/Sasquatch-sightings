import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendOneSignalToExternalIds } from '@/lib/onesignal'

const DEFAULT_ORIGIN = 'https://sightings.sasquatchcarpet.com'

function appOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    DEFAULT_ORIGIN
  ).replace(/\/+$/, '')
}

export function jobReminderPushIdempotencyKey(
  appointmentId: string,
  appointmentDate: string,
): string {
  const bytes = createHash('sha256')
    .update(`david-job-reminder:${appointmentId}:${appointmentDate}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function sendDavidJobReminderPush(params: {
  supabase: SupabaseClient
  appointmentId: string
  appointmentDate: string
  assignedStaffUserId: string | null
  customerName: string
  address: string
  timeLabel: string
}): Promise<boolean> {
  const {
    supabase,
    appointmentId,
    appointmentDate,
    assignedStaffUserId,
    customerName,
    address,
    timeLabel,
  } = params

  if (!assignedStaffUserId) return false

  const { data: staff, error } = await supabase
    .from('staff_users')
    .select('user_id, display_name, role, is_active')
    .or(`id.eq.${assignedStaffUserId},user_id.eq.${assignedStaffUserId}`)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error(
      '[job-reminder-push] Failed to resolve assigned staff:',
      error,
    )
    return false
  }

  const isDavid =
    staff?.is_active === true &&
    staff?.role === 'tech' &&
    String(staff.display_name || '')
      .trim()
      .toLowerCase()
      .startsWith('david')
  const davidUserId = String(staff?.user_id || '').trim()
  if (!isDavid || !davidUserId) return false

  const result = await sendOneSignalToExternalIds({
    externalIds: [davidUserId],
    heading: 'Job in 30 minutes',
    content: `${timeLabel} · ${customerName}\n${address}`,
    data: {
      type: 'job_reminder',
      appointment_id: appointmentId,
    },
    idempotencyKey: jobReminderPushIdempotencyKey(
      appointmentId,
      appointmentDate,
    ),
    url: `${appOrigin()}/tech/jobs/${appointmentId}`,
  })

  return Boolean(result)
}
