import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Check for Katie Santiago
const { data: customers } = await supabase
  .from('ops_customers')
  .select('*')
  .ilike('full_name', '%katie%')

console.log('\n👤 Customers matching Katie:')
console.log(JSON.stringify(customers, null, 2))

// Check for appointments tomorrow (April 17)
const { data: appointments } = await supabase
  .from('ops_appointments')
  .select('*, customer:ops_customers(*), address:ops_service_addresses(*)')
  .eq('appointment_date', '2026-04-17')

console.log('\n📅 Appointments for April 17:')
console.log(JSON.stringify(appointments, null, 2))
