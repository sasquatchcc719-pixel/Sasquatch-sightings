/**
 * Local Falcon API client.
 *
 * Geo-grid rank tracking from a vendor that reads Google's official Places API
 * rather than scraping, which makes it a genuinely independent second opinion
 * against our own DataForSEO-backed grid — when the two disagree, that's signal.
 *
 * Auth: every call is POST with `application/x-www-form-urlencoded` and the key
 * in the BODY, never the URL, so it stays out of logs and referrers.
 */

const BASE = 'https://api.localfalcon.com'

export type LFResponse<T> = {
  code: number
  success: boolean
  message: string
  data: T
}

function apiKey(): string {
  const key = process.env.LOCAL_FALCON_API_KEY
  if (!key) throw new Error('LOCAL_FALCON_API_KEY is not set')
  return key
}

async function call<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const body = new URLSearchParams({ api_key: apiKey() })
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') body.set(k, String(v))
  }

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })

  const text = await res.text()
  let json: LFResponse<T>
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Local Falcon returned non-JSON (${res.status}): ${text.slice(0, 200)}`)
  }

  if (!res.ok || json.success === false) {
    throw new Error(
      `Local Falcon ${res.status}: ${json.message || text.slice(0, 200)}`,
    )
  }
  return json.data
}

/* ----------------------------------------------------------------- account */

export type LFAccount = {
  key: string
  email: string
  first_name: string
  last_name: string
  meta?: Record<string, unknown>
  credits?: unknown
  [k: string]: unknown
}

export const getAccount = () => call<LFAccount>('/v2/account')

/* --------------------------------------------------------------- locations */

export type LFLocation = {
  place_id: string
  name?: string
  address?: string
  lat?: string | number
  lng?: string | number
  [k: string]: unknown
}

export const listLocations = (limit = 50) =>
  call<LFLocation[] | { locations?: LFLocation[] }>('/v1/locations/', { limit })

/** Find a business on Google by name + location, before adding it. */
export const searchLocations = (query: string, near?: string) =>
  call<unknown>('/v2/locations/search', { query, near })

/* ----------------------------------------------------------------- reports */

export type LFReport = {
  report_key: string
  place_id?: string
  keyword?: string
  grid_size?: string | number
  /** Average Rank Position across grid points where the business appeared. */
  arp?: string | number
  /** Average Total Rank Position — misses counted, so it moves with coverage. */
  atrp?: string | number
  /** Share of Local Voice, Local Falcon's weighted visibility measure. */
  solv?: string | number
  found_in?: string | number
  created_at?: string
  [k: string]: unknown
}

export const listReports = (params?: {
  limit?: number
  start_date?: string
  end_date?: string
  place_id?: string
  keyword?: string
}) => call<LFReport[] | { reports?: LFReport[] }>('/v1/reports/', { ...params })

/** A single scan with its per-point grid data. */
export const getReport = (reportKey: string) =>
  call<Record<string, unknown>>(`/v1/reports/${encodeURIComponent(reportKey)}/`)

/* -------------------------------------------------------------------- scan */

export type RunScanParams = {
  place_id: string
  keyword: string
  /** 3,5,7,9,11,13,15,17,19,21 — cost is grid_size² credits. */
  grid_size: number
  /** Miles from centre to the outermost point, 0.1 increments. */
  radius: number
  /** 'mi' | 'km' */
  measurement?: string
  lat?: number
  lng?: number
  /** google | chatgpt | gemini | grok | aimode — AI visibility uses the same credits. */
  platform?: string
}

/**
 * Trigger a scan. Costs grid_size² credits, so a 13x13 is 169.
 * Uses standard plan credits — this is NOT the $199/mo On-Demand API tier,
 * which only gates five legacy /v1/ coordinate endpoints we never call.
 */
export const runScan = (params: RunScanParams) =>
  call<Record<string, unknown>>('/v2/run-scan/', { ...params })

/** Credits a scan will consume, without spending any. */
export const scanCost = (gridSize: number) => gridSize * gridSize
