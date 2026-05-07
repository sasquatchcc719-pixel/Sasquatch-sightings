import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { photonFeaturesToSuggestions } from '@/lib/ops/address-suggest'
import { createAdminClient } from '@/supabase/server'

const PHOTON_URL = 'https://photon.komoot.io/api/'
// Service area: roughly Castle Rock–Colorado Springs (bias center ~south metro)
const BIAS_LAT = 38.8339
const BIAS_LON = -104.8214
// Photon bbox: minLon, minLat, maxLon, maxLat — Castle Rock to Colorado Springs corridor
const SERVICE_AREA_BBOX = '-105.35,38.6,-104.35,39.6' as const
// Broader CO fallback if local corridor query is sparse.
const COLORADO_BBOX = '-109.1,36.9,-102.0,41.1' as const
const SERVICE_STATE = 'CO' as const

type Suggestion = {
  label: string
  street: string
  city: string
  state: string
  zip: string
}

function makeKey(s: Suggestion): string {
  return [
    s.street.trim().toLowerCase(),
    s.city.trim().toLowerCase(),
    s.state.trim().toUpperCase(),
    s.zip.trim(),
  ].join('|')
}

function dedupeSuggestions(rows: Suggestion[]): Suggestion[] {
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const row of rows) {
    const key = makeKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

async function fetchPhotonFeatures(query: string, bbox: string) {
  const url = new URL(PHOTON_URL)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '14')
  url.searchParams.set('lang', 'en')
  url.searchParams.set('lat', String(BIAS_LAT))
  url.searchParams.set('lon', String(BIAS_LON))
  url.searchParams.set('bbox', bbox)

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'SasquatchCarpetCleaning/1.0 (address-suggest; +https://sasquatchcarpet.com)',
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    console.error('[address-suggest] Photon HTTP', res.status)
    return [] as Array<{ properties?: Record<string, string | undefined> }>
  }
  const data = (await res.json()) as {
    features?: Array<{ properties?: Record<string, string | undefined> }>
  }
  return data.features ?? []
}

async function fetchKnownLocalAddresses(q: string): Promise<Suggestion[]> {
  const query = q.trim()
  if (!query) return []
  const safe = query.replace(/[,%]/g, ' ').trim()
  if (!safe) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('ops_service_addresses')
    .select('street_1, city, state, zip_code')
    .eq('state', SERVICE_STATE)
    .or(
      [
        `street_1.ilike.%${safe}%`,
        `city.ilike.%${safe}%`,
        `zip_code.ilike.%${safe}%`,
      ].join(','),
    )
    .order('updated_at', { ascending: false })
    .limit(8)

  if (error) {
    console.error('[address-suggest] ops_service_addresses query failed', error)
    return []
  }

  return (data ?? [])
    .map((row) => {
      const street = String(row.street_1 || '').trim()
      const city = String(row.city || '').trim()
      const state = String(row.state || '')
        .trim()
        .toUpperCase()
      const zip = String(row.zip_code || '').trim()
      if (!street || !state) return null
      return {
        street,
        city,
        state,
        zip,
        label: [street, city, state, zip].filter(Boolean).join(', '),
      } satisfies Suggestion
    })
    .filter((row): row is Suggestion => Boolean(row))
}

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const q = String(request.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 3) {
    return NextResponse.json({ suggestions: [] })
  }

  try {
    const [known, localFeatures] = await Promise.all([
      fetchKnownLocalAddresses(q),
      fetchPhotonFeatures(q, SERVICE_AREA_BBOX),
    ])
    let suggestions = photonFeaturesToSuggestions(localFeatures, {
      allowedStateAbbr: SERVICE_STATE,
    })

    // Fallback: broader Colorado lookup for "down the road but not in local pass" misses.
    if (suggestions.length < 6) {
      const coFeatures = await fetchPhotonFeatures(
        `${q} Colorado`,
        COLORADO_BBOX,
      )
      const coSuggestions = photonFeaturesToSuggestions(coFeatures, {
        allowedStateAbbr: SERVICE_STATE,
      })
      suggestions = [...suggestions, ...coSuggestions]
    }

    const merged = dedupeSuggestions([...known, ...suggestions])
    return NextResponse.json({ suggestions: merged.slice(0, 12) })
  } catch (e) {
    console.error('[address-suggest]', e)
    return NextResponse.json({ suggestions: [] })
  }
}
