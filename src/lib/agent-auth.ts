import { createAdminClient } from '@/supabase/server'
import { createHash } from 'crypto'

export type AgentKeyInfo = {
  id: string
  label: string
  booking_mode: 'direct' | 'request'
}

export type AgentAuthResult =
  | { ok: true; key: AgentKeyInfo }
  | { ok: false; status: number; error: string }

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export async function validateAgentRequest(
  request: Request,
): Promise<AgentAuthResult> {
  const supabase = createAdminClient()

  const { data: settings } = await supabase
    .from('settings')
    .select('ai_agent_api_enabled')
    .limit(1)
    .maybeSingle()

  if (!settings?.ai_agent_api_enabled) {
    return {
      ok: false,
      status: 503,
      error: 'AI Agent API is currently disabled. Please try again later.',
    }
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      ok: false,
      status: 401,
      error: 'Missing or invalid Authorization header. Use: Bearer <api_key>',
    }
  }

  const rawKey = authHeader.slice(7)
  if (!rawKey) {
    return { ok: false, status: 401, error: 'API key is required' }
  }

  const keyHash = hashKey(rawKey)

  const { data: keyRow } = await supabase
    .from('agent_api_keys')
    .select('id, label, booking_mode')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .maybeSingle()

  if (!keyRow) {
    return { ok: false, status: 401, error: 'Invalid or revoked API key' }
  }

  return {
    ok: true,
    key: {
      id: keyRow.id,
      label: keyRow.label,
      booking_mode: keyRow.booking_mode as 'direct' | 'request',
    },
  }
}

export async function getAgentPromoSettings(): Promise<{
  enabled: boolean
  discount: number
  minimum: number
}> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('settings')
    .select(
      'ai_agent_promo_enabled, ai_agent_promo_discount, ai_agent_promo_minimum',
    )
    .limit(1)
    .maybeSingle()

  return {
    enabled: data?.ai_agent_promo_enabled ?? true,
    discount: Number(data?.ai_agent_promo_discount ?? 20),
    minimum: Number(data?.ai_agent_promo_minimum ?? 220),
  }
}

export function generateApiKey(): { raw: string; hash: string } {
  const raw = `sqa_${Array.from({ length: 40 }, () =>
    'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(
      Math.floor(Math.random() * 36),
    ),
  ).join('')}`
  return { raw, hash: hashKey(raw) }
}
