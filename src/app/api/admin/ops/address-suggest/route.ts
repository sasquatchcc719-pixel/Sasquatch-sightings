import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { photonFeaturesToSuggestions } from '@/lib/ops/address-suggest'

const PHOTON_URL = 'https://photon.komoot.io/api/'
// Colorado Springs (service area bias)
const BIAS_LAT = 38.8339
const BIAS_LON = -104.8214
const DEFAULT_STATE = 'CO'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech', 'marketing'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const q = String(request.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 3) {
    return NextResponse.json({ suggestions: [] })
  }

  const url = new URL(PHOTON_URL)
  url.searchParams.set('q', q)
  url.searchParams.set('limit', '12')
  url.searchParams.set('lang', 'en')
  url.searchParams.set('lat', String(BIAS_LAT))
  url.searchParams.set('lon', String(BIAS_LON))
  // Intentionally omit layer= — house-only was dropping most real-world matches.

  try {
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
      return NextResponse.json({ suggestions: [] })
    }
    const data = (await res.json()) as {
      features?: Array<{
        properties?: Record<string, string | undefined>
      }>
    }
    const suggestions = photonFeaturesToSuggestions(
      data.features,
      DEFAULT_STATE,
    )
    return NextResponse.json({ suggestions: suggestions.slice(0, 10) })
  } catch (e) {
    console.error('[address-suggest]', e)
    return NextResponse.json({ suggestions: [] })
  }
}
