import { createClient } from '@supabase/supabase-js'

export type CallRoutingConfig = {
  temporaryOpenLineMode: boolean
  businessHoursStart: number
  businessHoursEnd: number
  businessDays: string[]
  primaryForwardNumber: string
  /** Second phone to ring alongside the primary (e.g. owner's wife). Empty when unset. */
  secondaryForwardNumber: string
  failoverForwardNumber: string
  rabeccaSipUri: string
  openLineTimeoutSeconds: number
  ivrScheduleTimeoutSeconds: number
  ivrTechnicalTimeoutSeconds: number
}

/** Primary PSTN ring target for business-hours forwarding. */
const DEFAULT_CONFIG: CallRoutingConfig = {
  temporaryOpenLineMode: false,
  businessHoursStart: 9,
  businessHoursEnd: 17,
  businessDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  primaryForwardNumber: '+17206447577',
  secondaryForwardNumber: '',
  failoverForwardNumber: '+17206447577',
  rabeccaSipUri: '',
  openLineTimeoutSeconds: 30,
  ivrScheduleTimeoutSeconds: 30,
  ivrTechnicalTimeoutSeconds: 30,
}

function toPositiveInt(value: unknown, fallback: number): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  const rounded = Math.round(num)
  if (rounded <= 0) return fallback
  return rounded
}

function toPhone(value: unknown, fallback: string): string {
  const phone = String(value || '').trim()
  if (!phone.startsWith('+') || phone.length < 8) return fallback
  return phone
}

/** Like toPhone but returns '' (no number) when unset/invalid instead of a fallback. */
function toOptionalPhone(value: unknown): string {
  const phone = String(value || '').trim()
  if (!phone.startsWith('+') || phone.length < 8) return ''
  return phone
}

function toHour(value: unknown, fallback: number): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  const rounded = Math.round(num)
  if (rounded < 0 || rounded > 23) return fallback
  return rounded
}

function toBusinessDays(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const days = value.map((day) => String(day || '').trim()).filter(Boolean)
  return days.length ? days : fallback
}

function toSipUri(value: unknown, fallback: string): string {
  const uri = String(value || '').trim()
  if (!uri.startsWith('sip:') || !uri.includes('@')) return fallback
  return uri
}

export async function getCallRoutingConfig(): Promise<CallRoutingConfig> {
  const rabeccaSipUri = toSipUri(
    process.env.REBECCA_RETELL_SIP_URI,
    DEFAULT_CONFIG.rabeccaSipUri,
  )

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data } = await supabase
      .from('phone_settings')
      .select(
        'temporary_open_line_mode, business_hours_start, business_hours_end, business_days, dial_timeout, twilio_primary_forward_number, twilio_secondary_forward_number, twilio_failover_forward_number, ivr_schedule_timeout_seconds, ivr_technical_timeout_seconds',
      )
      .limit(1)
      .maybeSingle()

    if (!data) return { ...DEFAULT_CONFIG, rabeccaSipUri }

    return {
      temporaryOpenLineMode:
        data.temporary_open_line_mode !== undefined
          ? Boolean(data.temporary_open_line_mode)
          : DEFAULT_CONFIG.temporaryOpenLineMode,
      businessHoursStart: toHour(
        data.business_hours_start,
        DEFAULT_CONFIG.businessHoursStart,
      ),
      businessHoursEnd: toHour(
        data.business_hours_end,
        DEFAULT_CONFIG.businessHoursEnd,
      ),
      businessDays: toBusinessDays(
        data.business_days,
        DEFAULT_CONFIG.businessDays,
      ),
      primaryForwardNumber: toPhone(
        data.twilio_primary_forward_number,
        DEFAULT_CONFIG.primaryForwardNumber,
      ),
      secondaryForwardNumber: toOptionalPhone(
        data.twilio_secondary_forward_number,
      ),
      failoverForwardNumber: toPhone(
        data.twilio_failover_forward_number,
        DEFAULT_CONFIG.failoverForwardNumber,
      ),
      rabeccaSipUri,
      openLineTimeoutSeconds: toPositiveInt(
        data.dial_timeout,
        DEFAULT_CONFIG.openLineTimeoutSeconds,
      ),
      ivrScheduleTimeoutSeconds: toPositiveInt(
        data.ivr_schedule_timeout_seconds,
        DEFAULT_CONFIG.ivrScheduleTimeoutSeconds,
      ),
      ivrTechnicalTimeoutSeconds: toPositiveInt(
        data.ivr_technical_timeout_seconds,
        DEFAULT_CONFIG.ivrTechnicalTimeoutSeconds,
      ),
    }
  } catch (error) {
    console.error('[CallRoutingConfig] Falling back to defaults:', error)
    return { ...DEFAULT_CONFIG, rabeccaSipUri }
  }
}
