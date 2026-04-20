#!/usr/bin/env tsx
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function main() {
  const { data, error } = await supabase
    .from('service_catalog_items')
    .select('*')
    .ilike('name', '%sectional%')

  if (error) {
    console.error('Error:', error)
    process.exit(1)
  }

  console.log(JSON.stringify(data, null, 2))
}

main()
