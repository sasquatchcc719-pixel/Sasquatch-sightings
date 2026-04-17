import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const { data: appointments, error } = await supabase
  .from('ops_appointments')
  .select('*, customer:ops_customers!customer_id(*)')
  .eq('appointment_date', '2026-04-23')
  .order('start_time', { ascending: true })

if (error) {
  console.error('Error:', error)
  process.exit(1)
}

console.log('\n📅 WEDNESDAY, APRIL 23:\n')
console.log('='.repeat(70))

if (appointments.length === 0) {
  console.log('WIDE OPEN')
} else {
  appointments.forEach((appt, idx) => {
    console.log(`\n${idx + 1}. ${appt.start_time} - ${appt.end_time}`)
    console.log(`   ${appt.customer.full_name}`)
    console.log(`   Status: ${appt.status}`)
    console.log(`   $${appt.quoted_total}`)
  })
}

console.log('\n' + '='.repeat(70))
console.log(`Total: ${appointments.length} appointment(s)`)
