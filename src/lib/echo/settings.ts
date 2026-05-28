import { createAdminClient } from '@/supabase/server'
import type { EchoSettings } from './types'

export async function getSettings(): Promise<EchoSettings> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('echo_settings')
    .select('*')
    .eq('id', 1)
    .single()
  if (error || !data) {
    throw new Error(
      `Failed to read echo_settings: ${error?.message ?? 'no row found'}`,
    )
  }
  return data as EchoSettings
}

export async function updateSettings(
  patch: Partial<Omit<EchoSettings, 'id' | 'updated_at'>>,
): Promise<EchoSettings> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('echo_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('*')
    .single()
  if (error || !data) {
    throw new Error(
      `Failed to update echo_settings: ${error?.message ?? 'no row updated'}`,
    )
  }
  return data as EchoSettings
}
