export const LEAD_SOURCE_KEYS = [
  'google_search',
  'google_lsa',
  'nextdoor',
  'facebook',
  'instagram',
  'yelp',
  'chatgpt',
  'gemini',
  'claude',
  'grok',
  'perplexity',
  'vehicle_wrap',
  'door_hanger',
  'nfc_partner',
  'referral',
  'realtor_property_manager',
  'repeat_customer',
  'other',
] as const

export type LeadSourceKey = (typeof LEAD_SOURCE_KEYS)[number]

export type LeadSourceOption = {
  source_key: LeadSourceKey
  customer_label: string
  internal_label: string
  reporting_category: string
  display_order: number
  is_active: boolean
  is_public: boolean
  requires_detail: boolean
  detail_label: string | null
}

export type PublicLeadSourceOption = {
  key: LeadSourceKey
  value: LeadSourceKey
  customer_label: string
  label: string
  requires_detail: boolean
  detail_label: string | null
}

export type NormalizedLeadSource = {
  source_key: LeadSourceKey
  customer_label: string
  internal_label: string
  reporting_category: string
  lead_source: string
  lead_source_detail: string | null
  original_lead_source: string | null
  requires_detail: boolean
  detail_label: string | null
  was_legacy: boolean
  is_self_attribution: boolean
}

export const CANONICAL_LEAD_SOURCE_OPTIONS: LeadSourceOption[] = [
  {
    source_key: 'google_search',
    customer_label: 'Google Search / Maps',
    internal_label: 'Google Search / Maps',
    reporting_category: 'google_search',
    display_order: 10,
    is_active: true,
    is_public: true,
    requires_detail: false,
    detail_label: null,
  },
  {
    source_key: 'google_lsa',
    customer_label: 'Google Local Services',
    internal_label: 'Google Local Services',
    reporting_category: 'google_lsa',
    display_order: 20,
    is_active: true,
    is_public: true,
    requires_detail: false,
    detail_label: null,
  },
  {
    source_key: 'nextdoor',
    customer_label: 'Nextdoor',
    internal_label: 'Nextdoor',
    reporting_category: 'nextdoor',
    display_order: 30,
    is_active: true,
    is_public: true,
    requires_detail: false,
    detail_label: null,
  },
  {
    source_key: 'facebook',
    customer_label: 'Facebook',
    internal_label: 'Facebook',
    reporting_category: 'social',
    display_order: 40,
    is_active: true,
    is_public: true,
    requires_detail: false,
    detail_label: null,
  },
  {
    source_key: 'instagram',
    customer_label: 'Instagram',
    internal_label: 'Instagram',
    reporting_category: 'social',
    display_order: 50,
    is_active: true,
    is_public: true,
    requires_detail: false,
    detail_label: null,
  },
  {
    source_key: 'yelp',
    customer_label: 'Yelp',
    internal_label: 'Yelp',
    reporting_category: 'yelp',
    display_order: 60,
    is_active: true,
    is_public: true,
    requires_detail: false,
    detail_label: null,
  },
  {
    source_key: 'chatgpt',
    customer_label: 'ChatGPT',
    internal_label: 'ChatGPT',
    reporting_category: 'ai_assistant',
    display_order: 70,
    is_active: true,
    is_public: true,
    requires_detail: false,
    detail_label: null,
  },
  {
    source_key: 'gemini',
    customer_label: 'Gemini',
    internal_label: 'Gemini',
    reporting_category: 'ai_assistant',
    display_order: 80,
    is_active: true,
    is_public: true,
    requires_detail: false,
    detail_label: null,
  },
  {
    source_key: 'claude',
    customer_label: 'Claude',
    internal_label: 'Claude',
    reporting_category: 'ai_assistant',
    display_order: 90,
    is_active: true,
    is_public: true,
    requires_detail: false,
    detail_label: null,
  },
  {
    source_key: 'grok',
    customer_label: 'Grok',
    internal_label: 'Grok',
    reporting_category: 'ai_assistant',
    display_order: 100,
    is_active: true,
    is_public: true,
    requires_detail: false,
    detail_label: null,
  },
  {
    source_key: 'perplexity',
    customer_label: 'Perplexity',
    internal_label: 'Perplexity',
    reporting_category: 'ai_assistant',
    display_order: 110,
    is_active: true,
    is_public: true,
    requires_detail: false,
    detail_label: null,
  },
  {
    source_key: 'vehicle_wrap',
    customer_label: 'Saw a Sasquatch vehicle',
    internal_label: 'Saw a Sasquatch vehicle',
    reporting_category: 'offline',
    display_order: 120,
    is_active: true,
    is_public: true,
    requires_detail: false,
    detail_label: null,
  },
  {
    source_key: 'door_hanger',
    customer_label: 'Door hanger',
    internal_label: 'Door hanger',
    reporting_category: 'offline',
    display_order: 125,
    is_active: true,
    is_public: true,
    requires_detail: false,
    detail_label: null,
  },
  {
    source_key: 'nfc_partner',
    customer_label: 'NFC card / partner location',
    internal_label: 'NFC card / partner location',
    reporting_category: 'partner',
    display_order: 130,
    is_active: true,
    is_public: true,
    requires_detail: true,
    detail_label: 'Partner location or card code',
  },
  {
    source_key: 'referral',
    customer_label: 'Word of mouth / referral',
    internal_label: 'Word of mouth / referral',
    reporting_category: 'referral',
    display_order: 140,
    is_active: true,
    is_public: true,
    requires_detail: true,
    detail_label: 'Who referred you?',
  },
  {
    source_key: 'realtor_property_manager',
    customer_label: 'Realtor / property manager',
    internal_label: 'Realtor / property manager',
    reporting_category: 'referral',
    display_order: 150,
    is_active: true,
    is_public: true,
    requires_detail: true,
    detail_label: 'Name or company',
  },
  {
    source_key: 'repeat_customer',
    customer_label: 'Repeat customer',
    internal_label: 'Repeat customer',
    reporting_category: 'repeat_customer',
    display_order: 160,
    is_active: true,
    is_public: true,
    requires_detail: false,
    detail_label: null,
  },
  {
    source_key: 'other',
    customer_label: 'Other',
    internal_label: 'Other',
    reporting_category: 'other',
    display_order: 170,
    is_active: true,
    is_public: true,
    requires_detail: true,
    detail_label: 'Please tell us where you found us',
  },
]

const OPTIONS_BY_KEY = new Map(
  CANONICAL_LEAD_SOURCE_OPTIONS.map((option) => [option.source_key, option]),
)

const SELF_ATTRIBUTION_PATTERNS = [
  /\bharry\b/i,
  /\bscout\b/i,
  /\brabecca\b/i,
  /\brebecca\b/i,
  /\bretell\b/i,
  /\btelegram\b/i,
  /\bvoice\s*ai\b/i,
  /\bwebsite\b/i,
]

function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function compact(value: string): string {
  return comparable(value).replace(/\s+/g, '')
}

function splitLegacyDetail(value: string): {
  base: string
  detail: string | null
} {
  const match = /^\s*(.+?)\s*[-–—:]\s*(.+?)\s*$/.exec(value)
  if (!match) return { base: value, detail: null }
  return { base: match[1], detail: match[2] }
}

function keyFromComparable(value: string): LeadSourceKey | null {
  const c = comparable(value)
  const dense = c.replace(/\s+/g, '')
  if (!c) return null

  if (LEAD_SOURCE_KEYS.includes(value as LeadSourceKey)) {
    return value as LeadSourceKey
  }
  if (
    dense === 'googlesearch' ||
    dense === 'googlemaps' ||
    dense === 'googlesearchmaps' ||
    dense === 'google'
  ) {
    return 'google_search'
  }
  if (
    dense.includes('googlelsa') ||
    dense.includes('googlelocalservices') ||
    dense.includes('localservicesads') ||
    dense === 'lsa'
  ) {
    return 'google_lsa'
  }
  if (dense === 'nextdoor') return 'nextdoor'
  if (dense === 'facebook') return 'facebook'
  if (dense === 'instagram') return 'instagram'
  if (dense === 'yelp') return 'yelp'
  if (dense === 'chatgpt' || dense === 'openai') return 'chatgpt'
  if (dense === 'gemini' || dense === 'googleai') return 'gemini'
  if (dense === 'claude' || dense === 'anthropic') return 'claude'
  if (dense === 'grok') return 'grok'
  if (dense === 'perplexity') return 'perplexity'
  if (c.includes('truck') || c.includes('vehicle') || c.includes('wrap')) {
    return 'vehicle_wrap'
  }
  if (
    c.includes('door hanger') ||
    dense === 'doorhanger' ||
    c.includes('door tag') ||
    c.includes('door flyer')
  ) {
    return 'door_hanger'
  }
  if (
    c.includes('nfc') ||
    c.includes('partner') ||
    c.includes('milano') ||
    c.includes('scc20') ||
    c.includes('nail salon')
  ) {
    return 'nfc_partner'
  }
  if (
    c.includes('realtor') ||
    c.includes('property manager') ||
    c.includes('real estate')
  ) {
    return 'realtor_property_manager'
  }
  if (
    c.includes('word of mouth') ||
    c.includes('referral') ||
    c.includes('referred')
  ) {
    return 'referral'
  }
  if (c.includes('repeat') || c.includes('returning customer')) {
    return 'repeat_customer'
  }
  if (c === 'other') return 'other'

  return null
}

export function isLeadSourceKey(value: string): value is LeadSourceKey {
  return LEAD_SOURCE_KEYS.includes(value as LeadSourceKey)
}

export function getLeadSourceOption(key: LeadSourceKey): LeadSourceOption {
  return OPTIONS_BY_KEY.get(key) || OPTIONS_BY_KEY.get('other')!
}

export function getPublicLeadSourceOptions(
  options: LeadSourceOption[] = CANONICAL_LEAD_SOURCE_OPTIONS,
): PublicLeadSourceOption[] {
  return options
    .filter((option) => option.is_active && option.is_public)
    .sort((a, b) => a.display_order - b.display_order)
    .map((option) => ({
      key: option.source_key,
      value: option.source_key,
      customer_label: option.customer_label,
      label: option.customer_label,
      requires_detail: option.requires_detail,
      detail_label: option.detail_label,
    }))
}

export function isSelfAttribution(value: string): boolean {
  const normalized = value.trim()
  if (!normalized) return false
  return SELF_ATTRIBUTION_PATTERNS.some((pattern) =>
    pattern.test(normalized.replace(/_/g, ' ')),
  )
}

export function normalizeLeadSource(
  value: string | null | undefined,
  detailValue?: string | null,
): NormalizedLeadSource {
  const raw = String(value || '').trim()
  const explicitDetail = String(detailValue || '').trim()
  const split = splitLegacyDetail(raw)
  const key = keyFromComparable(raw) || keyFromComparable(split.base) || 'other'
  const option = getLeadSourceOption(key)
  const legacyDetail =
    explicitDetail ||
    (key === 'nfc_partner' && raw && !isLeadSourceKey(raw)
      ? split.detail || raw
      : '') ||
    (key === 'other' && raw && !/^other$/i.test(raw) ? raw : '') ||
    (key === 'referral' && split.detail ? split.detail : '') ||
    (key === 'realtor_property_manager' && split.detail ? split.detail : '')

  return {
    source_key: option.source_key,
    customer_label: option.customer_label,
    internal_label: option.internal_label,
    reporting_category: option.reporting_category,
    lead_source: option.customer_label,
    lead_source_detail: legacyDetail.trim() || null,
    original_lead_source:
      raw && (!isLeadSourceKey(raw) || raw !== option.source_key) ? raw : null,
    requires_detail: option.requires_detail,
    detail_label: option.detail_label,
    was_legacy: raw !== option.source_key,
    is_self_attribution: isSelfAttribution(raw),
  }
}

export function normalizeLeadSourceForDisplay(
  value: string | null | undefined,
): string {
  return normalizeLeadSource(value).customer_label
}

export function validateLeadSourceDetail(
  source: NormalizedLeadSource,
): string | null {
  if (source.requires_detail && !source.lead_source_detail) {
    return `${source.customer_label} requires a detail${source.detail_label ? `: ${source.detail_label}` : ''}.`
  }
  return null
}

export function optionFromDatabaseRow(
  row: Record<string, unknown>,
): LeadSourceOption | null {
  const key = String(row.source_key || '')
  if (!isLeadSourceKey(key)) return null
  return {
    source_key: key,
    customer_label: String(
      row.customer_label || getLeadSourceOption(key).customer_label,
    ),
    internal_label: String(
      row.internal_label || getLeadSourceOption(key).internal_label,
    ),
    reporting_category: String(
      row.reporting_category || getLeadSourceOption(key).reporting_category,
    ),
    display_order: Number(
      row.display_order || getLeadSourceOption(key).display_order,
    ),
    is_active: row.is_active !== false,
    is_public: row.is_public !== false,
    requires_detail: Boolean(row.requires_detail),
    detail_label:
      row.detail_label === null || row.detail_label === undefined
        ? null
        : String(row.detail_label),
  }
}

export const LEAD_SOURCE_TOOL_OPTIONS_TEXT =
  'Use canonical lead source keys only: google_search, google_lsa, nextdoor, facebook, instagram, yelp, chatgpt, gemini, claude, grok, perplexity, vehicle_wrap, door_hanger, nfc_partner, referral, realtor_property_manager, repeat_customer, other. Ask for the real marketing source. Never use Harry, Scout, Rabecca, Retell, Telegram, voice AI, or website as the lead source.'
