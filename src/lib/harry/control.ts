import { createAdminClient } from '@/supabase/server'

export const HARRY_CONTROL_KEYS = [
  'global_enabled',
  'inbound_channel_intake_enabled',
  'auto_reply_enabled',
  'booking_offers_enabled',
  'auto_create_leads_enabled',
  'escalation_alerts_enabled',
  'inbound_email_notifications_enabled',
  'call_missed_auto_sms_enabled',
  'channel_main_enabled',
  'channel_contest_enabled',
  'channel_vendor_enabled',
  'channel_business_card_enabled',
] as const

export type HarryControlKey = (typeof HARRY_CONTROL_KEYS)[number]
export type HarryChannelKey = 'inbound' | 'contest' | 'vendor' | 'business_card'

type HarryControlDefault = {
  setting_key: HarryControlKey
  group_key: string
  label: string
  description: string
  is_enabled: boolean
}

export type HarryControlSetting = HarryControlDefault & {
  id?: string
  updated_at?: string
}

export type HarryLogicProfile = {
  id: string
  profile_key: string
  label: string
  channel_key: string
  booking_mode: string
  prompt_overrides: string
  is_enabled: boolean
  updated_at: string
}

export type HarryKnowledgeBlock = {
  id: string
  category_key: string
  title: string
  content: string
  is_enabled: boolean
  sort_order: number
  updated_at: string
}

type HarryControlSnapshot = {
  settings: Record<HarryControlKey, boolean>
  rows: HarryControlSetting[]
  source: 'database' | 'fallback'
}

const HARRY_CONTROL_DEFAULTS: HarryControlDefault[] = [
  {
    setting_key: 'global_enabled',
    group_key: 'safety',
    label: 'Global Harry Enable',
    description: 'Master toggle for all Harry automation.',
    is_enabled: true,
  },
  {
    setting_key: 'inbound_channel_intake_enabled',
    group_key: 'inbound',
    label: 'Inbound Channel Intake',
    description: 'Allow inbound messages to enter Harry workflows.',
    is_enabled: true,
  },
  {
    setting_key: 'auto_reply_enabled',
    group_key: 'reply',
    label: 'Auto Reply',
    description: 'Allow Harry to send automatic text responses.',
    is_enabled: true,
  },
  {
    setting_key: 'booking_offers_enabled',
    group_key: 'booking',
    label: 'Booking Offers',
    description: 'Allow Harry to share booking links and slot offers.',
    is_enabled: true,
  },
  {
    setting_key: 'auto_create_leads_enabled',
    group_key: 'booking',
    label: 'Auto Create Leads',
    description: 'Allow automatic lead creation when data is complete.',
    is_enabled: true,
  },
  {
    setting_key: 'escalation_alerts_enabled',
    group_key: 'escalation',
    label: 'Escalation Alerts',
    description: 'Allow escalation and error alerts to admins.',
    is_enabled: true,
  },
  {
    setting_key: 'inbound_email_notifications_enabled',
    group_key: 'notifications',
    label: 'Inbound Email Notifications',
    description: 'Send inbound summary emails with Harry replies.',
    is_enabled: true,
  },
  {
    setting_key: 'call_missed_auto_sms_enabled',
    group_key: 'calls',
    label: 'Missed Call Auto SMS',
    description: 'Send Harry SMS after missed and after-hours calls.',
    is_enabled: true,
  },
  {
    setting_key: 'channel_main_enabled',
    group_key: 'channels',
    label: 'Main Channel',
    description: 'Enable Harry for main inbound traffic.',
    is_enabled: true,
  },
  {
    setting_key: 'channel_contest_enabled',
    group_key: 'channels',
    label: 'Contest Channel',
    description: 'Enable Harry for contest conversations.',
    is_enabled: true,
  },
  {
    setting_key: 'channel_vendor_enabled',
    group_key: 'channels',
    label: 'Vendor Channel',
    description: 'Enable Harry for vendor-source conversations.',
    is_enabled: true,
  },
  {
    setting_key: 'channel_business_card_enabled',
    group_key: 'channels',
    label: 'Business Card Channel',
    description: 'Enable Harry for business-card conversations.',
    is_enabled: true,
  },
]

const KNOWN_KEYS = new Set<string>(HARRY_CONTROL_KEYS)

const CACHE_TTL_MS = 30_000
let cachedSnapshot: { expiresAt: number; value: HarryControlSnapshot } | null =
  null

function isMissingRelationError(message: string | undefined): boolean {
  const normalized = String(message || '').toLowerCase()
  return (
    normalized.includes('does not exist') ||
    normalized.includes('relation') ||
    normalized.includes('schema cache')
  )
}

function toFallbackSnapshot(): HarryControlSnapshot {
  const settings = {} as Record<HarryControlKey, boolean>
  for (const row of HARRY_CONTROL_DEFAULTS) {
    settings[row.setting_key] = row.is_enabled
  }
  return {
    settings,
    rows: HARRY_CONTROL_DEFAULTS,
    source: 'fallback',
  }
}

export async function seedHarryControlDefaults(params?: { userId?: string }) {
  const supabase = createAdminClient()
  const rows = HARRY_CONTROL_DEFAULTS.map((row) => ({
    ...row,
    updated_by: params?.userId || null,
  }))
  const { error } = await supabase
    .from('harry_control_settings')
    .upsert(rows, { onConflict: 'setting_key' })
  if (error && !isMissingRelationError(error.message)) {
    throw error
  }
}

export async function getHarryControlSnapshot(params?: {
  bypassCache?: boolean
}): Promise<HarryControlSnapshot> {
  if (!params?.bypassCache && cachedSnapshot) {
    if (Date.now() < cachedSnapshot.expiresAt) {
      return cachedSnapshot.value
    }
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('harry_control_settings')
    .select(
      'id, setting_key, group_key, label, description, is_enabled, updated_at',
    )
    .in('setting_key', [...HARRY_CONTROL_KEYS])
    .order('group_key', { ascending: true })
    .order('label', { ascending: true })

  if (error) {
    if (isMissingRelationError(error.message)) {
      return toFallbackSnapshot()
    }
    throw error
  }

  const byKey = new Map<string, HarryControlSetting>()
  for (const row of data || []) {
    byKey.set(row.setting_key, row as HarryControlSetting)
  }

  const resolvedRows: HarryControlSetting[] = HARRY_CONTROL_DEFAULTS.map(
    (defaultRow) => ({
      ...defaultRow,
      ...(byKey.get(defaultRow.setting_key) || {}),
      is_enabled:
        byKey.get(defaultRow.setting_key)?.is_enabled ?? defaultRow.is_enabled,
    }),
  )

  const settings = {} as Record<HarryControlKey, boolean>
  for (const row of resolvedRows) {
    settings[row.setting_key] = row.is_enabled
  }

  const snapshot: HarryControlSnapshot = {
    settings,
    rows: resolvedRows,
    source: 'database',
  }
  cachedSnapshot = { expiresAt: Date.now() + CACHE_TTL_MS, value: snapshot }
  return snapshot
}

export function clearHarryControlCache() {
  cachedSnapshot = null
}

export function isHarryFunctionEnabled(
  snapshot: HarryControlSnapshot,
  key: HarryControlKey,
): boolean {
  return Boolean(snapshot.settings[key])
}

export function isHarryChannelEnabled(
  snapshot: HarryControlSnapshot,
  channel: HarryChannelKey,
): boolean {
  const channelMap: Record<HarryChannelKey, HarryControlKey> = {
    inbound: 'channel_main_enabled',
    contest: 'channel_contest_enabled',
    vendor: 'channel_vendor_enabled',
    business_card: 'channel_business_card_enabled',
  }
  return isHarryFunctionEnabled(snapshot, channelMap[channel])
}

export function getHarryControlDefaults(): HarryControlDefault[] {
  return HARRY_CONTROL_DEFAULTS
}

export function isKnownHarryControlKey(key: string): key is HarryControlKey {
  return KNOWN_KEYS.has(key)
}
