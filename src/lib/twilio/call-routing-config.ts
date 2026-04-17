import { createClient } from '@supabase/supabase-js'

export type CallRoutingConfig = {
  temporaryOpenLineMode: boolean
  primaryForwardNumber: string
  failoverForwardNumber: string
  openLineTimeoutSeconds: number
  ivrScheduleTimeoutSeconds: number
  ivrTechnicalTimeoutSeconds: number
}

/** Primary PSTN ring target (Chuck). Failover matches so owner-detect & DB rows stay valid; IVR no longer rings wife first. */
const DEFAULT_CONFIG: CallRoutingConfig = {
  temporaryOpenLineMode: false,
  primaryForwardNumber: '+17192498791',
  failoverForwardNumber: '+17192498791',
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

export async function getCallRoutingConfig(): Promise<CallRoutingConfig> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data } = await supabase
      .from('phone_settings')
      .select(
        'temporary_open_line_mode, dial_timeout, twilio_primary_forward_number, twilio_failover_forward_number, ivr_schedule_timeout_seconds, ivr_technical_timeout_seconds',
      )
      .limit(1)
      .maybeSingle()

    if (!data) return DEFAULT_CONFIG

    return {
      temporaryOpenLineMode:
        data.temporary_open_line_mode !== undefined
          ? Boolean(data.temporary_open_line_mode)
          : DEFAULT_CONFIG.temporaryOpenLineMode,
      primaryForwardNumber: toPhone(
        data.twilio_primary_forward_number,
        DEFAULT_CONFIG.primaryForwardNumber,
      ),
      failoverForwardNumber: toPhone(
        data.twilio_failover_forward_number,
        DEFAULT_CONFIG.failoverForwardNumber,
      ),
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
    return DEFAULT_CONFIG
  }
}
