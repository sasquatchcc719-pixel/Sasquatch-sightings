#!/usr/bin/env tsx
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
  const { data, error } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      status,
      appointment_date,
      start_time,
      created_at,
      ops_customers!ops_appointments_customer_id_fkey (
        full_name,
        phone
      ),
      ops_service_addresses (
        city,
        zip_code
      )
    `,
    )
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error('Error:', error)
    process.exit(1)
  }

  if (!data || data.length === 0) {
    console.log('✅ No pending approval appointments')
    process.exit(0)
  }

  console.log(`Found ${data.length} appointment(s) needing approval:\n`)

  for (const appt of data) {
    const customer = Array.isArray(appt.ops_customers)
      ? appt.ops_customers[0]
      : appt.ops_customers
    const address = Array.isArray(appt.ops_service_addresses)
      ? appt.ops_service_addresses[0]
      : appt.ops_service_addresses

    console.log(`ID: ${appt.id}`)
    console.log(`Customer: ${customer?.full_name || 'Unknown'}`)
    console.log(
      `Location: ${address?.city || 'Unknown'}, ${address?.zip_code || 'Unknown'}`,
    )
    console.log(`Date: ${appt.appointment_date} at ${appt.start_time}`)
    console.log(`Created: ${new Date(appt.created_at).toLocaleString()}`)
    console.log('---')
  }
}

main()
