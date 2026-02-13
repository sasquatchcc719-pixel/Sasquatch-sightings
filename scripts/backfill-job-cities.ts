#!/usr/bin/env tsx
/**
 * One-time script to backfill city for jobs that have city = 'Unknown'
 *
 * Usage:
 *   npx tsx scripts/backfill-job-cities.ts
 *
 * This script:
 * 1. Finds all jobs with GPS coordinates and city = 'Unknown'
 * 2. Calls resolveCityForJob (Nominatim + region fallback) for each
 * 3. Updates the job with the resolved city (never leaves "Unknown")
 * 4. Respects 1-second rate limit between Nominatim API calls
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

// Load .env.local so env vars are available when run from project root
const envPath = join(process.cwd(), '.env.local')
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (match)
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '').trim()
  }
}
import { resolveCityForJob } from '../src/lib/geocode'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  console.log('🚀 Starting city backfill for jobs with city = "Unknown"...\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing environment variables!')
    console.error(
      'Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY',
    )
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  console.log('📊 Querying jobs with city = "Unknown" and valid GPS...')
  const { data: jobs, error: queryError } = await supabase
    .from('jobs')
    .select('id, gps_lat, gps_lng, city, created_at')
    .eq('city', 'Unknown')
    .not('gps_lat', 'is', null)
    .not('gps_lng', 'is', null)
    .order('created_at', { ascending: true })

  if (queryError) {
    console.error('❌ Database query error:', queryError)
    process.exit(1)
  }

  if (!jobs || jobs.length === 0) {
    console.log('✅ No jobs need backfilling. All done!')
    process.exit(0)
  }

  console.log(`📍 Found ${jobs.length} job(s) to backfill\n`)

  let successCount = 0
  let failCount = 0
  let skipCount = 0

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]
    const progress = `[${i + 1}/${jobs.length}]`

    console.log(`${progress} Job ${job.id}...`)
    console.log(`   GPS: ${job.gps_lat}, ${job.gps_lng}`)

    try {
      const lat = Number(job.gps_lat)
      const lng = Number(job.gps_lng)

      if (isNaN(lat) || isNaN(lng)) {
        console.log(`   ⚠️  Invalid coordinates, skipping`)
        skipCount++
        continue
      }

      console.log(`   🌍 Resolving city (Nominatim + fallback)...`)
      const resolved = await resolveCityForJob(lat, lng)

      console.log(
        `   📍 Resolved: ${resolved.city}${resolved.state ? ', ' + resolved.state : ''}`,
      )

      const { error: updateError } = await supabase
        .from('jobs')
        .update({
          city: resolved.city,
          ...(resolved.neighborhood != null && {
            neighborhood: resolved.neighborhood,
          }),
        })
        .eq('id', job.id)

      if (updateError) {
        console.error(`   ❌ Update failed:`, updateError.message)
        failCount++
      } else {
        console.log(`   ✅ Updated`)
        successCount++
      }
    } catch (err) {
      console.error(
        `   ❌ Error:`,
        err instanceof Error ? err.message : String(err),
      )
      failCount++
    }

    if (i < jobs.length - 1) {
      console.log(`   ⏱️  Waiting 1 second (Nominatim rate limit)...`)
      await sleep(1000)
      console.log()
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('📊 BACKFILL COMPLETE')
  console.log('='.repeat(60))
  console.log(`✅ Successful: ${successCount}`)
  console.log(`❌ Failed:     ${failCount}`)
  console.log(`⚠️  Skipped:    ${skipCount}`)
  console.log(`📍 Total:      ${jobs.length}`)
  console.log('='.repeat(60))

  if (failCount > 0) {
    console.log('\n⚠️  Some updates failed. Check the logs above.')
    process.exit(1)
  }
  console.log('\n✅ All jobs processed successfully!')
  process.exit(0)
}

main().catch((err) => {
  console.error('\n💥 Fatal error:', err)
  process.exit(1)
})
