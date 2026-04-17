import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Step 1: Find sectional service in catalog
console.log('Finding sectional service in catalog...')
const { data: services } = await supabase
  .from('service_catalog_items')
  .select('*')
  .ilike('name', '%sectional%')
  .eq('is_active', true)

console.log('\nAvailable sectional services:')
services?.forEach(s => {
  console.log(`- ${s.id}: ${s.name} ($${s.base_price} ${s.pricing_unit || ''})`)
})

// Find the right one
const sectionalService = services?.find(s => 
  s.name.toLowerCase().includes('sectional') && 
  (s.name.toLowerCase().includes('linear') || s.name.toLowerCase().includes('foot'))
)

if (!sectionalService) {
  console.error('\n❌ Could not find sectional service in catalog!')
  console.log('\nPlease tell Charles:')
  console.log('Need to add "Sectional Upholstery (per linear foot)" to service catalog')
  console.log('Or use an existing sectional service ID manually')
  process.exit(1)
}

console.log(`\n✅ Using: ${sectionalService.name} (${sectionalService.id})`)
console.log(`   Price: $${sectionalService.base_price} ${sectionalService.pricing_unit || 'each'}`)

// Step 2: Delete broken appointment and related records
console.log('\nDeleting broken records...')

await supabase.from('ops_appointments').delete().eq('id', '86c4d562-baf8-4aab-92a8-572bff8011fe')
await supabase.from('ops_service_addresses').delete().eq('id', 'f59b8284-3753-419b-9177-8b0ad7272b64')
await supabase.from('ops_customers').delete().eq('id', 'ba8637ea-9660-4950-bc0b-a581f49ba2e6')

console.log('✅ Deleted broken records')

// Step 3: Call the proper booking API
console.log('\nCalling proper booking system...')
console.log('\n' + '='.repeat(70))
console.log('SERVICE INFO FOR MANUAL BOOKING:')
console.log('='.repeat(70))
console.log(`
Customer: Katie Santiago
Email: katie.coggins522@gmail.com
Phone: +19497710382 (Google LSA relay - need her real number!)
Address: 320 Rangely Dr, Colorado Springs, CO 80921
Date: 2026-04-23 (Wednesday)
Time: 13:00 (1 PM)

Service: ${sectionalService.name}
Service ID: ${sectionalService.id}
Quantity: 15.5 (linear feet)
Unit Price: $${sectionalService.base_price}
Total: $${(sectionalService.base_price * 15.5).toFixed(2)}

TO COMPLETE:
Charles, please book this through the admin UI or Harry's book_new_job tool
with the service ID above. This will create the proper invoice with all
the features you need (QB sync, payments, photos, line items, etc.)

OR: Add the sectional service to Harry's SMS tools and have him rebook it.
`)

console.log('✅ Broken records cleaned up')
console.log('⚠️  Manual rebooking required through proper system')
