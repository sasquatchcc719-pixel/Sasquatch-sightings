#!/usr/bin/env tsx
/**
 * One-time script to backfill city and state for existing sightings
 * 
 * Usage:
 *   npx tsx scripts/backfill-sighting-locations.ts
 * 
 * This script:
 * 1. Finds all sightings with GPS coordinates but no city/state
 * 2. Calls Nominatim reverse geocoding for each
 * 3. Updates the database with location data
 * 4. Respects 1-second rate limit between API calls
 */

import { createClient } from '@supabase/supabase-js'
import { reverseGeocode } from '../src/lib/geocode'

// Sleep utility for rate limiting
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  console.log('🚀 Starting location backfill for existing sightings...\n')

  // Initialize Supabase client (server-side)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing environment variables!')
    console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
    console.error('Make sure .env.local is present with these values.')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Query sightings that need backfilling
  console.log('📊 Querying sightings that need location data...')
  const { data: sightings, error: queryError } = await supabase
    .from('sightings')
    .select('id, gps_lat, gps_lng, created_at')
    .not('gps_lat', 'is', null)
    .not('gps_lng', 'is', null)
    .is('city', null)
    .order('created_at', { ascending: true })

  if (queryError) {
    console.error('❌ Database query error:', queryError)
    process.exit(1)
  }

  if (!sightings || sightings.length === 0) {
    console.log('✅ No sightings need backfilling. All done!')
    process.exit(0)
  }

  console.log(`📍 Found ${sightings.length} sighting(s) to backfill\n`)

  // Track statistics
  let successCount = 0
  let failCount = 0
  let skipCount = 0

  // Process each sighting
  for (let i = 0; i < sightings.length; i++) {
    const sighting = sightings[i]
    const progress = `[${i + 1}/${sightings.length}]`

    console.log(`${progress} Processing sighting ${sighting.id}...`)
    console.log(`   GPS: ${sighting.gps_lat}, ${sighting.gps_lng}`)

    try {
      // Validate coordinates
      const lat = Number(sighting.gps_lat)
      const lng = Number(sighting.gps_lng)

      if (isNaN(lat) || isNaN(lng)) {
        console.log(`   ⚠️  Invalid coordinates, skipping`)
        skipCount++
        continue
      }

      // Call Nominatim API
      console.log(`   🌍 Calling Nominatim...`)
      const geocodeResult = await reverseGeocode(lat, lng)

      // Check if we got useful data
      if (!geocodeResult.city || geocodeResult.city === 'Unknown') {
        console.log(`   ⚠️  Could not determine city, skipping`)
        skipCount++
        continue
      }

      console.log(`   📍 Found: ${geocodeResult.city}${geocodeResult.state ? ', ' + geocodeResult.state : ''}`)

      // Update database
      const { error: updateError } = await supabase
        .from('sightings')
        .update({
          city: geocodeResult.city,
          state: geocodeResult.state,
        })
        .eq('id', sighting.id)

      if (updateError) {
        console.error(`   ❌ Update failed:`, updateError.message)
        failCount++
      } else {
        console.log(`   ✅ Updated successfully`)
        successCount++
      }
    } catch (error) {
      console.error(`   ❌ Error:`, error instanceof Error ? error.message : String(error))
      failCount++
    }

    // Rate limiting: Wait 1 second before next request (except for last item)
    if (i < sightings.length - 1) {
      console.log(`   ⏱️  Waiting 1 second (Nominatim rate limit)...`)
      await sleep(1000)
      console.log() // Empty line for readability
    }
  }

  // Final summary
  console.log('\n' + '='.repeat(60))
  console.log('📊 BACKFILL COMPLETE')
  console.log('='.repeat(60))
  console.log(`✅ Successful: ${successCount}`)
  console.log(`❌ Failed:     ${failCount}`)
  console.log(`⚠️  Skipped:    ${skipCount}`)
  console.log(`📍 Total:      ${sightings.length}`)
  console.log('='.repeat(60))

  if (failCount > 0) {
    console.log('\n⚠️  Some updates failed. Check the logs above for details.')
    process.exit(1)
  } else {
    console.log('\n✅ All sightings processed successfully!')
    process.exit(0)
  }
}

// Run the script
main().catch((error) => {
  console.error('\n💥 Fatal error:', error)
  process.exit(1)
})
