/**
 * Local Falcon API client — full surface used by Sightings.
 *
 * Geo-grid rank tracking from a vendor that reads Google's official Places API
 * rather than scraping, which makes it a genuinely independent second opinion
 * against our own DataForSEO-backed grid.
 *
 * Auth: every call is POST with `application/x-www-form-urlencoded` and the key
 * in the BODY, never the URL. Paths match https://docs.localfalcon.com/openapi.yaml
 *
 * Intentionally skipped: On-Demand $199 /v1/{grid,places,result,search,scan}
 * single-point endpoints and knowledge-base browser UI.
 */

const BASE = 'https://api.localfalcon.com'

export type LFResponse<T> = {
  code: number
  success: boolean
  message: string | false
  data: T
}

export type LFPlatform =
  | 'google'
  | 'apple'
  | 'gaio'
  | 'chatgpt'
  | 'gemini'
  | 'grok'
  | 'aimode'

export const LF_PLATFORMS: LFPlatform[] = [
  'google',
  'apple',
  'chatgpt',
  'gemini',
  'grok',
  'gaio',
  'aimode',
]

export const LF_GRID_SIZES = [3, 5, 7, 9, 11, 13, 15, 17, 19, 21] as const

function apiKey(): string {
  const key = process.env.LOCAL_FALCON_API_KEY
  if (!key) throw new Error('LOCAL_FALCON_API_KEY is not set')
  return key
}

type ParamValue = string | number | boolean | undefined | null

async function call<T>(
  path: string,
  params: Record<string, ParamValue> = {},
): Promise<T> {
  const body = new URLSearchParams({ api_key: apiKey() })
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (typeof v === 'boolean') body.set(k, v ? 'true' : 'false')
    else body.set(k, String(v))
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
    throw new Error(
      `Local Falcon returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
    )
  }

  if (
    !res.ok ||
    json.success === false ||
    (typeof json.code === 'number' && json.code >= 400)
  ) {
    const msg =
      typeof json.message === 'string' && json.message
        ? json.message
        : text.slice(0, 200)
    throw new Error(`Local Falcon ${res.status}: ${msg}`)
  }
  return json.data
}

/** Pull a named collection out of list payloads. */
export function lfCollection<T = Record<string, unknown>>(
  data: unknown,
  key: string,
): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const arr = obj[key] ?? obj.results ?? obj.items
    if (Array.isArray(arr)) return arr as T[]
  }
  return []
}

/* ----------------------------------------------------------------- account */

export type LFAccount = {
  key?: string
  email?: string
  first_name?: string
  last_name?: string
  credits?: unknown
  meta?: Record<string, unknown>
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

export const listLocations = (params?: {
  limit?: number
  query?: string
  next_token?: string
  fieldmask?: string
}) => call<unknown>('/v1/locations/', { ...params })

export const searchLocations = (params: {
  query: string
  near?: string
  next_token?: string
  fieldmask?: string
}) => call<unknown>('/v2/locations/search', params)

export const saveLocation = (params: {
  place_id: string
  [k: string]: ParamValue
}) => call<unknown>('/v2/locations/add', params)

/* ----------------------------------------------------------- scan reports */

export type LFReport = {
  report_key: string
  place_id?: string
  keyword?: string
  grid_size?: string | number
  arp?: string | number
  atrp?: string | number
  solv?: string | number
  saiv?: string | number
  found_in?: string | number
  platform?: string
  [k: string]: unknown
}

export const listReports = (params?: {
  limit?: number
  start_date?: string
  end_date?: string
  place_id?: string
  keyword?: string
  grid_size?: string | number
  campaign_key?: string
  platform?: string
  next_token?: string
  fieldmask?: string
}) => call<unknown>('/v1/reports/', { ...params })

export const getReport = (reportKey: string, fieldmask?: string) =>
  call<Record<string, unknown>>(
    `/v1/reports/${encodeURIComponent(reportKey)}/`,
    fieldmask ? { fieldmask } : {},
  )

/* -------------------------------------------------------------------- scan */

export type RunScanParams = {
  place_id: string
  keyword: string
  /** 3,5,7,9,11,13,15,17,19,21 — cost is grid_size² credits. */
  grid_size: number
  /** Miles (or km) from centre to the outermost point. */
  radius: number
  measurement?: 'mi' | 'km'
  lat: number
  lng: number
  platform?: LFPlatform | string
  ai_analysis?: boolean
  eager?: boolean
}

/**
 * Trigger a scan. Costs grid_size² credits.
 * Uses standard plan credits — not the On-Demand single-point tier.
 */
export const runScan = (params: RunScanParams) =>
  call<Record<string, unknown>>('/v2/run-scan/', {
    place_id: params.place_id,
    keyword: params.keyword,
    grid_size: params.grid_size,
    radius: params.radius,
    measurement: params.measurement ?? 'mi',
    lat: params.lat,
    lng: params.lng,
    platform: params.platform ?? 'google',
    ai_analysis: params.ai_analysis ?? false,
    eager: params.eager ?? false,
  })

export const scanCost = (gridSize: number) => gridSize * gridSize

/* --------------------------------------------------------------- campaigns */

export const listCampaigns = (params?: {
  start_date?: string
  end_date?: string
  place_id?: string
  run_date?: string
  next_token?: string
  fieldmask?: string
}) => call<unknown>('/v1/campaigns/', { ...params })

export const getCampaign = (
  reportKey: string,
  params?: { run?: string; fieldmask?: string },
) =>
  call<unknown>(`/v1/campaigns/${encodeURIComponent(reportKey)}`, {
    ...params,
  })

export const createCampaign = (params: {
  name: string
  measurement: 'mi' | 'km'
  grid_size: number | string
  radius: number | string
  frequency: 'one-time' | 'daily' | 'weekly' | 'biweekly' | 'monthly'
  place_id: string
  keyword: string
  start_date: string
  start_time: string
  ai_analysis?: boolean | '0' | '1'
  notify?: boolean | '0' | '1'
  email_recipients?: string
  email_subject?: string
  email_body?: string
}) =>
  call<unknown>('/v2/campaigns/create', {
    ...params,
    ai_analysis:
      params.ai_analysis === true || params.ai_analysis === '1' ? '1' : '0',
    notify: params.notify === true || params.notify === '1' ? '1' : '0',
  })

export const runCampaign = (campaign_key: string) =>
  call<unknown>('/v2/campaigns/run', { campaign_key })

export const pauseCampaign = (campaign_key: string) =>
  call<unknown>('/v2/campaigns/pause', { campaign_key })

export const resumeCampaign = (params: {
  campaign_key: string
  start_date?: string
  start_time?: string
}) => call<unknown>('/v2/campaigns/resume', params)

export const reactivateCampaign = (campaign_key: string) =>
  call<unknown>('/v2/campaigns/reactivate', { campaign_key })

/* ------------------------------------------------------------------ trends */

export const listTrendReports = (params?: {
  start_date?: string
  end_date?: string
  place_id?: string
  keyword?: string
  grid_size?: string | number
  platform?: string
  next_token?: string
  fieldmask?: string
}) => call<unknown>('/v1/trend-reports/', { ...params })

export const getTrendReport = (reportKey: string, fieldmask?: string) =>
  call<unknown>(`/v1/trend-reports/${encodeURIComponent(reportKey)}`, {
    ...(fieldmask ? { fieldmask } : {}),
  })

/* ------------------------------------------------------------ competitors */

export const listCompetitorReports = (params?: {
  limit?: number
  start_date?: string
  end_date?: string
  place_id?: string
  keyword?: string
  grid_size?: string | number
  platform?: string
  next_token?: string
  fieldmask?: string
}) => call<unknown>('/v1/competitor-reports/', { ...params })

export const getCompetitorReport = (
  reportKey: string,
  params?: { fieldmask?: string },
) =>
  call<unknown>(
    `/v1/competitor-reports/${encodeURIComponent(reportKey)}`,
    params ?? {},
  )

/* ----------------------------------------------------- location / keyword */

export const listLocationReports = (params?: {
  start_date?: string
  end_date?: string
  place_id?: string
  next_token?: string
  fieldmask?: string
}) => call<unknown>('/v1/location-reports/', { ...params })

export const getLocationReport = (reportKey: string, fieldmask?: string) =>
  call<unknown>(`/v1/location-reports/${encodeURIComponent(reportKey)}`, {
    ...(fieldmask ? { fieldmask } : {}),
  })

export const listKeywordReports = (params?: {
  keyword?: string
  start_date?: string
  end_date?: string
  limit?: number
  next_token?: string
  fieldmask?: string
}) => call<unknown>('/v1/keyword-reports/', { ...params })

export const getKeywordReport = (reportKey: string, fieldmask?: string) =>
  call<unknown>(`/v1/keyword-reports/${encodeURIComponent(reportKey)}`, {
    ...(fieldmask ? { fieldmask } : {}),
  })

/* -------------------------------------------------------------- autoscans */

export const listAutoScans = (params?: {
  next_token?: string
  fieldmask?: string
}) => call<unknown>('/v1/autoscans/', { ...params })

/* ----------------------------------------------------------- falcon guard */

export const listGuardLocations = (params?: {
  next_token?: string
  fieldmask?: string
}) => call<unknown>('/v1/guard/', { ...params })

export const getGuardReport = (placeId: string, fieldmask?: string) =>
  call<unknown>(`/v1/guard/${encodeURIComponent(placeId)}`, {
    ...(fieldmask ? { fieldmask } : {}),
  })

export const addGuardLocations = (place_id: string) =>
  call<unknown>('/v2/guard/add', { place_id })

export const pauseGuard = (place_id: string) =>
  call<unknown>('/v2/guard/pause', { place_id })

export const resumeGuard = (place_id: string) =>
  call<unknown>('/v2/guard/resume', { place_id })

export const deleteGuard = (place_id: string) =>
  call<unknown>('/v2/guard/delete', { place_id })

/* ------------------------------------------------------ reviews analysis */

export const listReviewsReports = (params?: {
  reviews_key?: string
  place_id?: string
  frequency?: string
  limit?: number
  next_token?: string
  fieldmask?: string
}) => call<unknown>('/v1/reviews/', { ...params })

export const getReviewsReport = (reportKey: string, fieldmask?: string) =>
  call<unknown>(`/v1/reviews/${encodeURIComponent(reportKey)}`, {
    ...(fieldmask ? { fieldmask } : {}),
  })
