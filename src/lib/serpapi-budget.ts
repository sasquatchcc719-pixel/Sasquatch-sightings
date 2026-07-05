import { createAdminClient } from '@/supabase/server'

export const DEFAULT_SERPAPI_MONTHLY_LIMIT = 250
export const DEFAULT_SERPAPI_BILLING_CYCLE_DAY = 6
export const DEFAULT_SERPAPI_BILLING_TIME_ZONE = 'America/Denver'

type SerpApiFetchInit = RequestInit & {
  next?: {
    revalidate?: number | false
  }
}

export type SerpApiReservation = {
  period_start: string
  limit: number
  used: number
  remaining: number
  last_call_at?: string
}

export class SerpApiQuotaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SerpApiQuotaError'
  }
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(parsed, max)
}

export function getSerpApiMonthlyLimit(): number {
  return parsePositiveInt(
    process.env.SERPAPI_MONTHLY_LIMIT,
    DEFAULT_SERPAPI_MONTHLY_LIMIT,
  )
}

export function getSerpApiBillingCycleDay(): number {
  return parsePositiveInt(
    process.env.SERPAPI_BILLING_CYCLE_DAY,
    DEFAULT_SERPAPI_BILLING_CYCLE_DAY,
    28,
  )
}

function datePartsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(byType.get('year')),
    month: Number(byType.get('month')),
    day: Number(byType.get('day')),
  }
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(
    2,
    '0',
  )}`
}

function previousMonth(year: number, month: number) {
  return month === 1
    ? { year: year - 1, month: 12 }
    : { year, month: month - 1 }
}

export function getSerpApiPeriodStart(
  date = new Date(),
  cycleDay = getSerpApiBillingCycleDay(),
  timeZone = process.env.SERPAPI_BILLING_TIME_ZONE ||
    DEFAULT_SERPAPI_BILLING_TIME_ZONE,
): string {
  const { year, month, day } = datePartsInTimeZone(date, timeZone)
  const safeCycleDay = Math.min(Math.max(cycleDay, 1), 28)

  if (day >= safeCycleDay) {
    return formatDate(year, month, safeCycleDay)
  }

  const prev = previousMonth(year, month)
  return formatDate(prev.year, prev.month, safeCycleDay)
}

function normalizeReservation(
  data: unknown,
  periodStart: string,
  monthlyLimit: number,
): SerpApiReservation {
  const value =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const used = Number(value.used ?? 0)
  const limit = Number(value.limit ?? monthlyLimit)
  return {
    period_start: String(value.period_start ?? periodStart),
    limit,
    used,
    remaining: Number(value.remaining ?? Math.max(limit - used, 0)),
    ...(typeof value.last_call_at === 'string' && {
      last_call_at: value.last_call_at,
    }),
  }
}

export function isSerpApiProviderQuotaMessage(text: string): boolean {
  return /exhausted|quota|monthly|out of searches|used up all your searches/i.test(
    text,
  )
}

export async function reserveSerpApiSearch(input: {
  source: string
  query: string
}): Promise<SerpApiReservation> {
  const monthlyLimit = getSerpApiMonthlyLimit()
  const periodStart = getSerpApiPeriodStart()
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('reserve_serpapi_search', {
    p_period_start: periodStart,
    p_source: input.source,
    p_query: input.query,
    p_monthly_limit: monthlyLimit,
  })

  if (error) {
    throw new SerpApiQuotaError(
      isSerpApiProviderQuotaMessage(error.message)
        ? error.message
        : `SerpApi quota gate failed: ${error.message}`,
    )
  }

  return normalizeReservation(data, periodStart, monthlyLimit)
}

export async function recordSerpApiProviderQuotaExhausted(input: {
  source: string
  query: string
  error: string
}): Promise<void> {
  const monthlyLimit = getSerpApiMonthlyLimit()
  const periodStart = getSerpApiPeriodStart()
  const key = `serpapi_usage_${periodStart}`
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()

  const current =
    data?.value && typeof data.value === 'object' && !Array.isArray(data.value)
      ? (data.value as Record<string, unknown>)
      : {}
  const calls = Array.isArray(current.calls) ? current.calls : []
  const now = new Date().toISOString()
  const nextCalls = [
    ...calls,
    {
      at: now,
      source: input.source,
      query: input.query.slice(0, 500),
      provider_error: input.error.slice(0, 500),
    },
  ].slice(-monthlyLimit)

  await supabase.from('system_settings').upsert({
    key,
    value: {
      ...current,
      period_start: periodStart,
      limit: monthlyLimit,
      used: monthlyLimit,
      remaining: 0,
      provider_exhausted_at: now,
      provider_error: input.error.slice(0, 500),
      calls: nextCalls,
    },
    updated_at: now,
  })
}

export async function fetchSerpApiJson<T>(input: {
  source: string
  query: string
  params: URLSearchParams
  endpoint?: string
  init?: SerpApiFetchInit
}): Promise<T> {
  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) {
    throw new Error('SERPAPI_API_KEY is not set')
  }

  await reserveSerpApiSearch({ source: input.source, query: input.query })

  const url = new URL(input.endpoint || 'https://serpapi.com/search')
  for (const [key, value] of input.params.entries()) {
    url.searchParams.append(key, value)
  }
  url.searchParams.set('api_key', apiKey)

  const res = await fetch(
    url.toString(),
    input.init ?? { next: { revalidate: 0 } },
  )

  if (!res.ok) {
    const text = await res.text()
    if (isSerpApiProviderQuotaMessage(text)) {
      await recordSerpApiProviderQuotaExhausted({
        source: input.source,
        query: input.query,
        error: text,
      }).catch(() => undefined)
    }
    throw new Error(
      `SerpApi ${input.source} request failed: ${res.status} ${text}`,
    )
  }

  const data = (await res.json()) as T
  const providerError =
    data && typeof data === 'object' && 'error' in data
      ? String((data as { error?: unknown }).error || '')
      : ''
  if (providerError && isSerpApiProviderQuotaMessage(providerError)) {
    await recordSerpApiProviderQuotaExhausted({
      source: input.source,
      query: input.query,
      error: providerError,
    }).catch(() => undefined)
  }

  return data
}
