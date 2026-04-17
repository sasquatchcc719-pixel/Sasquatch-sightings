import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ADDRESS_ID    = '79aeee9e-f68e-4072-8038-72febc1fb58b'
const APPOINTMENT_ID = 'd05b9bfb-ebae-4eb9-acca-81f3f5e9e349'
const NEW_ADDRESS = {
  street_1: '18280 Woodhaven Drive',
  street_2: null,
  city: 'Colorado Springs',
  state: 'CO',
  zip_code: '80908',
  updated_at: new Date().toISOString(),
}

// Update the service address record
const { data: updatedAddr, error: addrErr } = await supabase
  .from('ops_service_addresses')
  .update(NEW_ADDRESS)
  .eq('id', ADDRESS_ID)
  .select()
  .single()

if (addrErr) {
  console.error('Address update FAILED:', addrErr)
  process.exit(1)
}

console.log('✅ Address updated:')
console.log(`   ${updatedAddr.street_1}, ${updatedAddr.city}, ${updatedAddr.state} ${updatedAddr.zip_code}`)

// Verify the appointment now shows the new address
const { data: appt } = await supabase
  .from('ops_appointments')
  .select('id, appointment_date, start_time, ops_service_addresses(street_1, city, state, zip_code)')
  .eq('id', APPOINTMENT_ID)
  .single()

const addr = Array.isArray(appt?.ops_service_addresses) ? appt.ops_service_addresses[0] : appt?.ops_service_addresses
console.log(`\n✅ Appointment ${appt.appointment_date} at ${appt.start_time?.slice(0,5)} now shows:`)
console.log(`   ${addr?.street_1}, ${addr?.city}, ${addr?.state} ${addr?.zip_code}`)
