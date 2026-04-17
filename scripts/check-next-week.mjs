import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Check April 21-25 (Monday-Friday)
const days = ['2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24', '2026-04-25']
const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

console.log('\n📅 NEXT WEEK (April 21-25):\n')
console.log('='.repeat(70))

for (let i = 0; i < days.length; i++) {
  const date = days[i]
  const dayName = dayNames[i]
  
  const { data: appointments } = await supabase
    .from('ops_appointments')
    .select('*, customer:ops_customers!customer_id(*)')
    .eq('appointment_date', date)
    .order('start_time', { ascending: true })
  
  console.log(`\n${dayName} (${date}):`)
  
  if (!appointments || appointments.length === 0) {
    console.log('  ✅ WIDE OPEN')
  } else {
    appointments.forEach(appt => {
      console.log(`  ${appt.start_time} - ${appt.end_time}: ${appt.customer.full_name} ($${appt.quoted_total})`)
    })
  }
}

console.log('\n' + '='.repeat(70))
