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
    .from('ops_appointments')
    .select(
      '*, ops_customers!ops_appointments_customer_id_fkey(full_name, phone, email)',
    )
    .eq('id', '3ed5da3a-1308-4c61-aea7-9bb9f01600ec')
    .single()

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log("\n=== Mariah's Appointment Details ===\n")
  console.log('Customer:', data.ops_customers.full_name)
  console.log('Phone:', data.ops_customers.phone)
  console.log('Email:', data.ops_customers.email)
  console.log('\nBooking Info:')
  console.log('  Channel:', data.booking_channel)
  console.log('  Source:', data.source)
  console.log('  Lead Source:', data.lead_source)
  console.log('\nDate/Time:', data.appointment_date, 'at', data.start_time)

  // Check if she came through Scout
  if (data.booking_channel === 'ai_agent') {
    console.log('\n✅ Booked via Scout (website chat)')

    // Try to find Scout conversation logs
    const phone = data.ops_customers.phone
    if (phone) {
      const { data: logs } = await supabase
        .from('ai_chat_logs')
        .select('*')
        .eq('metadata->>phone', phone)
        .order('created_at', { ascending: false })
        .limit(10)

      if (logs && logs.length > 0) {
        console.log(`\nFound ${logs.length} chat messages from this customer`)
      }
    }
  } else {
    console.log(`\n📝 Booked via: ${data.booking_channel || 'unknown'}`)
  }
}

main()
