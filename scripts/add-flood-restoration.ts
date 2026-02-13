#!/usr/bin/env tsx
/**
 * One-time script to add 'Flood Restoration' to the services table
 *
 * Usage:
 *   npx tsx scripts/add-flood-restoration.ts
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

async function main() {
  console.log('🚀 Starting service addition: Flood Restoration...\n')

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

  const serviceName = 'Flood Restoration'
  const serviceSlug = 'flood-restoration'

  // Check if it already exists
  const { data: existing, error: checkError } = await supabase
    .from('services')
    .select('id, name')
    .eq('slug', serviceSlug)
    .single()

  if (checkError && checkError.code !== 'PGRST116') {
    // PGRST116 is "No rows found", which is good
    console.error('❌ Error checking for existing service:', checkError)
    process.exit(1)
  }

  if (existing) {
    console.log(
      `⚠️  Service "${serviceName}" already exists (ID: ${existing.id})`,
    )
    process.exit(0)
  }

  console.log(`➕ Inserting "${serviceName}"...`)

  const { data: inserted, error: insertError } = await supabase
    .from('services')
    .insert({
      name: serviceName,
      slug: serviceSlug,
    })
    .select()
    .single()

  if (insertError) {
    console.error('❌ Failed to insert service:', insertError)
    process.exit(1)
  }

  console.log(`✅ Successfully added "${inserted.name}" (ID: ${inserted.id})`)
  process.exit(0)
}

main().catch((err) => {
  console.error('\n💥 Fatal error:', err)
  process.exit(1)
})
