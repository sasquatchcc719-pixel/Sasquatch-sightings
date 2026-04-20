#!/usr/bin/env tsx
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function main() {
  console.log('Updating sectional pricing to $50 per seat...\n')

  // Update cloth sectional
  const { error: error1 } = await supabase
    .from('service_catalog_items')
    .update({
      name: 'Sectional (cloth)',
      slug: 'sectional-cloth',
      description:
        'Refresh your sectional with our professional cloth upholstery cleaning! Priced at $50 per seat (cushion section). We remove dirt, stains, and allergens, revitalizing your furniture and extending its life.',
      base_price: 50,
      pricing_unit: 'fixed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', 'dc74c110-5a3a-4470-90f8-889d534a6e6c')

  if (error1) {
    console.error('Error updating cloth sectional:', error1)
    process.exit(1)
  }
  console.log('✅ Updated: Sectional (cloth) → $50 per seat')

  // Update leather sectional
  const { error: error2 } = await supabase
    .from('service_catalog_items')
    .update({
      name: 'Sectional (leather)',
      slug: 'sectional-leather',
      description:
        'Restore the beauty and longevity of your leather sectional with professional cleaning at $50 per seat (cushion section). This service removes dirt, oils, and stains, preserving the leather appearance and comfort while protecting your investment.',
      base_price: 50,
      pricing_unit: 'fixed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', 'dd621cb0-d449-433c-9cfc-a2de4a3b8f70')

  if (error2) {
    console.error('Error updating leather sectional:', error2)
    process.exit(1)
  }
  console.log('✅ Updated: Sectional (leather) → $50 per seat')

  console.log('\n✅ All sectional pricing updated!')
}

main()
