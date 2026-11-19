import { createAdminClient } from '@/supabase/server'

const PUBLIC_KEY = 'harry_voice_public_enabled'
const PREVIEW_KEY = 'harry_voice_cell_preview'

export function normalizeHarryCell(input: unknown) {
  if (typeof input !== 'string') return ''
  const number = input.trim().replace(/[\s().-]/g, '')
  if (/^\d{10}$/.test(number)) return '+1' + number
  if (/^1\d{10}$/.test(number)) return '+' + number
  return /^\+[1-9]\d{7,14}$/.test(number) ? number : ''
}

export function isHarryMainNumber(to: string) {
  return Boolean(to && to === process.env.TWILIO_PHONE_NUMBER?.trim())
}

export function harryPreviewReady() {
  return Boolean(
    /^proj_[a-zA-Z0-9_-]+$/.test(
      process.env.HARRY_VOICE_PROJECT_ID?.trim() || '',
    ) &&
    process.env.HARRY_VOICE_WEBHOOK_SECRET?.trim() &&
    process.env.OPENAI_API_KEY?.trim(),
  )
}

export function harryPublicReady() {
  return harryPreviewReady() && process.env.HARRY_VOICE_PUBLIC_READY === 'true'
}

export async function getHarrySettings() {
  const { data, error } = await createAdminClient()
    .from('system_settings')
    .select('key,value')
    .in('key', [PUBLIC_KEY, PREVIEW_KEY])
    .abortSignal(AbortSignal.timeout(1800))
  if (error) throw error
  const value = (key: string) => data?.find((row) => row.key === key)?.value
  const preview = value(PREVIEW_KEY)
  const previewPhone = normalizeHarryCell(preview?.phone)
  const expires = Date.parse(preview?.expiresAt)
  const active = Boolean(
    harryPreviewReady() &&
    previewPhone &&
    Number.isFinite(expires) &&
    expires > Date.now(),
  )
  return {
    previewReady: harryPreviewReady(),
    publicReady: harryPublicReady(),
    publicEnabled: harryPublicReady() && value(PUBLIC_KEY) === true,
    previewPhone: active ? previewPhone : '',
    previewExpiresAt: active ? new Date(expires).toISOString() : null,
  }
}

export async function getHarryAccess(caller: string) {
  if (!harryPreviewReady()) return { preview: false, publicEnabled: false }
  try {
    const settings = await getHarrySettings()
    return {
      preview: Boolean(
        settings.previewPhone &&
        settings.previewPhone === normalizeHarryCell(caller),
      ),
      publicEnabled: settings.publicEnabled,
    }
  } catch {
    console.error(
      '[Harry Voice] Settings unavailable; using existing call routing',
    )
    return { preview: false, publicEnabled: false }
  }
}

export async function isHarryPreviewCall(callSid: string, callerPhone: string) {
  const { data, error } = await createAdminClient()
    .from('call_logs')
    .select('voice_preview')
    .eq('call_sid', callSid)
    .eq('caller_phone', callerPhone)
    .maybeSingle()
  return !error && data?.voice_preview === true
}

export async function setHarryPublic(enabled: boolean) {
  await saveSetting(PUBLIC_KEY, enabled)
}

export async function setHarryPreview(phone: string | null) {
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString()
  await saveSetting(PREVIEW_KEY, phone ? { phone, expiresAt } : {})
}

async function saveSetting(key: string, value: unknown) {
  const { error } = await createAdminClient()
    .from('system_settings')
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
  if (error) throw error
}
