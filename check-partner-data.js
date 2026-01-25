// Quick script to check partner data in Supabase
// Run with: NEXT_PUBLIC_SUPABASE_URL=your-url SUPABASE_SERVICE_ROLE_KEY=your-key node check-partner-data.js

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in environment')
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
})

async function checkPartners() {
  console.log('🔍 Checking partners table...\n')
  
  const { data, error } = await supabase
    .from('partners')
    .select('id, name, email, phone, company_name, credit_balance')
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  console.log(`Found ${data.length} partner(s):\n`)
  
  data.forEach((partner, index) => {
    console.log(`${index + 1}. ${partner.name}`)
    console.log(`   Company: ${partner.company_name}`)
    console.log(`   Email: ${partner.email}`)
    console.log(`   Phone: ${partner.phone || '❌ NO PHONE'}`)
    console.log(`   Balance: $${partner.credit_balance}`)
    console.log('')
  })
}

checkPartners()
