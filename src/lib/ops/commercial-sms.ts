import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeCommercialSmsPhone } from './commercial'

export function isCommercialSmsOptOut(
  message: string,
  optOutType?: string,
): boolean {
  return (
    optOutType?.trim().toUpperCase() === 'STOP' ||
    /^(stop|stopall|unsubscribe|cancel|end|quit)$/i.test(message.trim())
  )
}

export async function recordCommercialSmsOptOut(
  db: SupabaseClient,
  params: {
    customerId: string | null
    phone: string
    message: string
    optOutType?: string
  },
) {
  if (
    !params.customerId ||
    !isCommercialSmsOptOut(params.message, params.optOutType)
  ) {
    return false
  }
  const phone = normalizeCommercialSmsPhone(params.phone)
  if (!phone) return false
  const { data: profile, error: profileError } = await db
    .from('ops_commercial_profiles')
    .select('scheduling_sms_phone,scheduling_sms_enabled')
    .eq('customer_id', params.customerId)
    .maybeSingle()
  if (profileError) throw profileError
  if (
    !profile?.scheduling_sms_enabled ||
    profile.scheduling_sms_phone !== phone
  ) {
    return false
  }
  const { error } = await db.rpc('set_commercial_sms_preference', {
    p_customer_id: params.customerId,
    p_user_id: null,
    p_phone: phone,
    p_enabled: false,
    p_consent_text: '',
    p_source: 'customer_reply',
    p_ip_address: null,
    p_user_agent: 'Twilio inbound SMS',
  })
  if (error) throw error
  return true
}
