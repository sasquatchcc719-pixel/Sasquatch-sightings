#!/usr/bin/env node
/**
 * Add 8x5 area rug to service catalog
 * Run with: node scripts/add-8x5-rug.js
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function addRug() {
  console.log('Adding 8x5 area rug to service catalog...')

  const { data, error } = await supabase
    .from('service_catalog_items')
    .upsert(
      {
        name: 'Area Rug 8x5',
        slug: 'area-rug-8x5',
        description: 'Professional cleaning for 8x5 area rug',
        category: 'rug cleaning',
        default_duration_minutes: 30,
        buffer_minutes: 30,
        base_price: 32.0,
        pricing_unit: 'per rug',
        is_active: true,
        online_booking_enabled: true,
        sort_order: 410,
      },
      { onConflict: 'slug' },
    )
    .select()

  if (error) {
    console.error('❌ Error adding rug:', error)
    process.exit(1)
  }

  console.log('✅ Successfully added 8x5 area rug:')
  console.log(data)
  console.log('\n8x5 rug is now available on:')
  console.log('  - Public booking website')
  console.log('  - Booking widget')
  console.log('  - Admin interfaces')
  console.log(`  - Price: $${data[0].base_price}`)
}

addRug()
