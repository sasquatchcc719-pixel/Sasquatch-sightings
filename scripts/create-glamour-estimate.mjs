import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Step 1: Create or find customer
const customerData = {
  full_name: 'Glamour Salon and Spa',
  phone: '+18067908958',
  email: null,
  notes: 'Nail salon owner - interested in tile floor cleaning and polishing'
}

console.log('Creating/finding customer...')
const { data: existingCustomer } = await supabase
  .from('ops_customers')
  .select('*')
  .eq('phone', '+18067908958')
  .single()

let customerId
if (existingCustomer) {
  console.log('Customer exists:', existingCustomer.id)
  customerId = existingCustomer.id
} else {
  const { data: newCustomer, error: customerError } = await supabase
    .from('ops_customers')
    .insert(customerData)
    .select()
    .single()

  if (customerError) {
    console.error('Customer creation error:', customerError)
    process.exit(1)
  }
  
  console.log('Customer created:', newCustomer.id)
  customerId = newCustomer.id
}

// Step 2: Create service address
const addressData = {
  customer_id: customerId,
  label: 'Glamour Salon',
  street_1: '13880 Gleneagle Dr',
  street_2: null,
  city: 'Colorado Springs',
  state: 'CO',
  zip_code: '80921',
  notes: 'Nail salon with tile flooring'
}

console.log('\nCreating service address...')
const { data: address, error: addressError } = await supabase
  .from('ops_service_addresses')
  .insert(addressData)
  .select()
  .single()

if (addressError) {
  console.error('Address error:', addressError)
  process.exit(1)
}

console.log('Service address created:', address.id)

// Step 3: Get conversation ID
const { data: conversation } = await supabase
  .from('conversations')
  .select('id')
  .eq('phone_number', '+18067908958')
  .single()

// Step 4: Create appointment
const appointmentData = {
  customer_id: customerId,
  service_address_id: address.id,
  conversation_id: conversation?.id || null,
  appointment_date: '2026-04-16',
  start_time: '16:00:00',
  end_time: '18:00:00',
  status: 'booked',
  quoted_total: 0,
  internal_notes: 'ESTIMATE - Tile floor cleaning and polishing for nail salon. Old, dull tile needs professional cleaning and buffing to restore shine.',
  booking_channel: 'admin',
  source: 'inbound'
}

console.log('\nCreating appointment...')
const { data: appointment, error: apptError } = await supabase
  .from('ops_appointments')
  .insert(appointmentData)
  .select()
  .single()

if (apptError) {
  console.error('Appointment error:', apptError)
  process.exit(1)
}

console.log('\n✅ Estimate appointment created!')
console.log('Appointment ID:', appointment.id)
console.log('Customer: Glamour Salon and Spa')
console.log('Date: Today (April 16) at 4:00 PM - 6:00 PM')
console.log('Type: ESTIMATE ($0)')
console.log('Address: 13880 Gleneagle Dr, Colorado Springs, CO 80921')
