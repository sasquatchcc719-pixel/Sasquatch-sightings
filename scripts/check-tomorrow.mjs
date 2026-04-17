import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Get all appointments for April 17
const { data: appointments, error } = await supabase
  .from('ops_appointments')
  .select('*, customer:ops_customers!customer_id(*), address:ops_service_addresses!service_address_id(*)')
  .eq('appointment_date', '2026-04-17')
  .order('start_time', { ascending: true })

if (error) {
  console.error('Error:', error)
  process.exit(1)
}

console.log('\n📅 TOMORROW (April 17) Schedule:\n')
console.log('='.repeat(70))

if (appointments.length === 0) {
  console.log('NO APPOINTMENTS SCHEDULED')
} else {
  appointments.forEach((appt, idx) => {
    console.log(`\n${idx + 1}. ${appt.start_time} - ${appt.end_time}`)
    console.log(`   Customer: ${appt.customer.full_name}`)
    console.log(`   Address: ${appt.address.street_1}, ${appt.address.city}`)
    console.log(`   Status: ${appt.status}`)
    console.log(`   Cost: $${appt.quoted_total}`)
    if (appt.internal_notes) {
      console.log(`   Notes: ${appt.internal_notes}`)
    }
  })
}

console.log('\n' + '='.repeat(70))
console.log(`Total: ${appointments.length} appointments`)
