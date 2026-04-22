/**
 * One-time backfill: forward-geocode all service addresses that lack lat/lng.
 *
 * Run with:
 *   pnpm tsx scripts/geocode-service-addresses.ts
 *
 * Nominatim rate limit: 1 request/second max.
 * Expects NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import path from 'path'

config({ path: path.join(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local',
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function nominatimSearch(
  street: string,
  city: string,
  state: string,
  zip: string,
): Promise<{ lat: number; lng: number } | null> {
  const params = new URLSearchParams({
    format: 'json',
    street,
    city,
    state,
    postalcode: zip,
    countrycodes: 'us',
    limit: '1',
    addressdetails: '0',
  })

  const url = `https://nominatim.openstreetmap.org/search?${params}`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'SasquatchCarpetCleaning/1.0 (backfill)' },
  })

  if (!res.ok) {
    console.error(`  Nominatim HTTP ${res.status}`)
    return null
  }

  const results = await res.json()

  if (!Array.isArray(results) || results.length === 0) {
    // Fallback: try zip + city only
    const params2 = new URLSearchParams({
      format: 'json',
      city,
      state,
      postalcode: zip,
      countrycodes: 'us',
      limit: '1',
      addressdetails: '0',
    })
    const res2 = await fetch(
      `https://nominatim.openstreetmap.org/search?${params2}`,
      {
        headers: { 'User-Agent': 'SasquatchCarpetCleaning/1.0 (backfill)' },
      },
    )
    if (!res2.ok) return null
    const r2 = await res2.json()
    if (!Array.isArray(r2) || r2.length === 0) return null
    const lat = parseFloat(r2[0].lat)
    const lng = parseFloat(r2[0].lon)
    if (isNaN(lat) || isNaN(lng)) return null
    console.log('    [fallback: zip/city]')
    return { lat, lng }
  }

  const lat = parseFloat(results[0].lat)
  const lng = parseFloat(results[0].lon)
  if (isNaN(lat) || isNaN(lng)) return null
  return { lat, lng }
}

async function main() {
  console.log('🗺  Fetching ungeooded service addresses…')

  const { data: addresses, error } = await supabase
    .from('ops_service_addresses')
    .select('id, street_1, city, state, zip_code')
    .is('latitude', null)
    .order('created_at')

  if (error) {
    console.error('DB error:', error.message)
    process.exit(1)
  }

  if (!addresses || addresses.length === 0) {
    console.log('✅ All service addresses already geocoded.')
    return
  }

  console.log(`Found ${addresses.length} addresses to geocode.\n`)

  let success = 0
  let failed = 0

  for (let i = 0; i < addresses.length; i++) {
    const addr = addresses[i]
    const label = `${addr.street_1}, ${addr.city}, ${addr.state} ${addr.zip_code}`
    process.stdout.write(`[${i + 1}/${addresses.length}] ${label} … `)

    const coords = await nominatimSearch(
      addr.street_1,
      addr.city,
      addr.state,
      addr.zip_code,
    )

    if (coords) {
      const { error: updateErr } = await supabase
        .from('ops_service_addresses')
        .update({
          latitude: coords.lat,
          longitude: coords.lng,
          geocoded_at: new Date().toISOString(),
          geocode_source: 'nominatim-backfill',
          updated_at: new Date().toISOString(),
        })
        .eq('id', addr.id)

      if (updateErr) {
        console.log(`ERROR updating: ${updateErr.message}`)
        failed++
      } else {
        console.log(`✓  (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`)
        success++
      }
    } else {
      console.log('✗  (no result)')
      failed++
    }

    // Nominatim: 1 req/sec max — wait 1100ms between requests
    if (i < addresses.length - 1) await sleep(1100)
  }

  console.log(`\n✅ Done. Geocoded: ${success}  Failed: ${failed}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
