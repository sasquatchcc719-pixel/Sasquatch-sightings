import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeOpsPhone, opsPhoneLookupVariants } from '@/lib/ops/phone'

const PROMOTIONAL_SMS_TYPES = [
  'tomorrow_fill_offer',
  'gap_outreach',
  'cleaning_reminder_prompt',
  'day_7_nurture',
  'day_14_nurture',
]

const SMS_LABELS: Record<string, string> = {
  tomorrow_fill_offer: 'Tomorrow Fill offer text',
  gap_outreach: 'schedule-gap offer text',
  cleaning_reminder_prompt: 'cleaning reminder text',
  day_7_nurture: '7-day follow-up text',
  day_14_nurture: '14-day follow-up text',
}

export type BookingAlertHistory = {
  customerHistory: string
  recentSmsTouch: string | null
}

function formatDenverDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
  })
}

export async function getBookingAlertHistory(params: {
  supabase: SupabaseClient
  customerId: string
  phone: string
  now?: Date
}): Promise<BookingAlertHistory> {
  const { supabase, customerId, phone } = params
  const now = params.now ?? new Date()

  let priorAppointmentCount: number | null = null
  try {
    const { count, error } = await supabase
      .from('ops_appointments')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
    if (error) throw error
    priorAppointmentCount = count ?? 0
  } catch (error) {
    console.error('[booking-alert] customer history lookup failed:', error)
  }

  let recentSmsTouch: string | null = null
  const phoneVariants = opsPhoneLookupVariants(normalizeOpsPhone(phone))
  if (phoneVariants.length > 0) {
    try {
      const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      const { data, error } = await supabase
        .from('sms_logs')
        .select('message_type, sent_at, created_at')
        .in('recipient_phone', phoneVariants)
        .in('message_type', PROMOTIONAL_SMS_TYPES)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (data) {
        const label = SMS_LABELS[data.message_type] || data.message_type
        const occurredAt = data.sent_at || data.created_at
        recentSmsTouch = `LIKELY: received a tracked ${label} on ${formatDenverDate(occurredAt)} (no exact booking-link match)`
      }
    } catch (error) {
      console.error('[booking-alert] promotional SMS lookup failed:', error)
    }
  }

  const customerHistory =
    priorAppointmentCount === null
      ? 'Unknown — history check unavailable'
      : priorAppointmentCount === 0
        ? 'New customer — no prior appointments'
        : `Returning customer — ${priorAppointmentCount} prior appointment${priorAppointmentCount === 1 ? '' : 's'}`

  return { customerHistory, recentSmsTouch }
}
