import type { SupabaseClient } from '@supabase/supabase-js'

export const NEXTDOOR_STATS_KEY = 'nextdoor_public_metrics'
export const NEXTDOOR_PROFILE_URL =
  'https://nextdoor.com/pages/sasquatch-carpet-cleaning-llc-palmer-lake-co/'

export type NextdoorPublicMetrics = {
  faves: number
  recommendations: number
  mentions: number
  pageViews: number
  url: string
  source: string
  lastVerifiedAt: string
}

// Verified from the owner's Nextdoor business-page screenshot on 2026-09-07.
// These values also keep prerendered/fallback pages truthful before the first
// database update is saved.
export const DEFAULT_NEXTDOOR_PUBLIC_METRICS: NextdoorPublicMetrics = {
  faves: 187,
  recommendations: 50,
  mentions: 202,
  pageViews: 314,
  url: NEXTDOOR_PROFILE_URL,
  source: 'owner_verified_fallback',
  lastVerifiedAt: '2026-09-07T19:07:46.000Z',
}

function safeCount(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

export function normalizeNextdoorPublicMetrics(
  value: unknown,
): NextdoorPublicMetrics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_NEXTDOOR_PUBLIC_METRICS }
  }

  const record = value as Record<string, unknown>
  return {
    faves: safeCount(record.faves, DEFAULT_NEXTDOOR_PUBLIC_METRICS.faves),
    recommendations: safeCount(
      record.recommendations,
      DEFAULT_NEXTDOOR_PUBLIC_METRICS.recommendations,
    ),
    mentions: safeCount(
      record.mentions,
      DEFAULT_NEXTDOOR_PUBLIC_METRICS.mentions,
    ),
    pageViews: safeCount(
      record.pageViews,
      DEFAULT_NEXTDOOR_PUBLIC_METRICS.pageViews,
    ),
    url:
      typeof record.url === 'string' && record.url.startsWith('https://')
        ? record.url
        : NEXTDOOR_PROFILE_URL,
    source:
      typeof record.source === 'string' && record.source.trim()
        ? record.source
        : 'owner_verified',
    lastVerifiedAt:
      typeof record.lastVerifiedAt === 'string' && record.lastVerifiedAt.trim()
        ? record.lastVerifiedAt
        : DEFAULT_NEXTDOOR_PUBLIC_METRICS.lastVerifiedAt,
  }
}

export function parseNextdoorMetricsInput(input: string):
  | {
      ok: true
      counts: Pick<
        NextdoorPublicMetrics,
        'faves' | 'recommendations' | 'mentions' | 'pageViews'
      >
    }
  | { ok: false; message: string } {
  const values = input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((value) => Number(value.replaceAll(',', '')))

  if (
    values.length !== 4 ||
    values.some(
      (value) => !Number.isInteger(value) || value < 0 || value > 1_000_000,
    )
  ) {
    return {
      ok: false,
      message:
        'Use: /nextdoor FAVES RECOMMENDATIONS MENTIONS PAGE_VIEWS — for example, /nextdoor 187 50 202 314',
    }
  }

  return {
    ok: true,
    counts: {
      faves: values[0],
      recommendations: values[1],
      mentions: values[2],
      pageViews: values[3],
    },
  }
}

export async function getNextdoorPublicMetrics(
  supabase: SupabaseClient,
): Promise<NextdoorPublicMetrics> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', NEXTDOOR_STATS_KEY)
    .maybeSingle()

  if (error) throw error
  return normalizeNextdoorPublicMetrics(data?.value)
}

export async function saveNextdoorPublicMetrics(params: {
  supabase: SupabaseClient
  counts: Pick<
    NextdoorPublicMetrics,
    'faves' | 'recommendations' | 'mentions' | 'pageViews'
  >
  source: string
}): Promise<NextdoorPublicMetrics> {
  const now = new Date().toISOString()
  const metrics = normalizeNextdoorPublicMetrics({
    ...params.counts,
    url: NEXTDOOR_PROFILE_URL,
    source: params.source,
    lastVerifiedAt: now,
  })

  const { error } = await params.supabase.from('system_settings').upsert({
    key: NEXTDOOR_STATS_KEY,
    value: metrics,
    updated_at: now,
  })

  if (error) throw error
  return metrics
}
