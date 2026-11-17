import type { SupabaseClient } from '@supabase/supabase-js'

export const STATION_HEALTH_SMS_SETTING_KEY =
  'station_health_partner_sms_enabled'

export type StationHealthSmsSetting = {
  enabled: boolean
  source: 'saved' | 'default'
}

export async function readStationHealthSmsSetting(
  supabase: Pick<SupabaseClient, 'from'>,
): Promise<StationHealthSmsSetting> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', STATION_HEALTH_SMS_SETTING_KEY)
    .maybeSingle()

  if (error) {
    throw new Error(
      `Failed to read station-health SMS setting: ${error.message}`,
    )
  }

  if (!data) {
    return { enabled: false, source: 'default' }
  }

  const value = data.value
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof (value as { enabled?: unknown }).enabled !== 'boolean'
  ) {
    throw new Error('Station-health SMS setting is unreadable')
  }

  return {
    enabled: (value as { enabled: boolean }).enabled,
    source: 'saved',
  }
}
