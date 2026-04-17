import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import fetch from 'node-fetch'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Use the admin API to book properly
const bookingData = {
  customer: {
    first_name: 'Katie',
    last_name: 'Santiago',
    email: 'katie.coggins522@gmail.com',
    phone: '+19497710382',
  },
  address: {
    street_1: '320 Rangely Dr',
    city: 'Colorado Springs',
    state: 'CO',
    zip_code: '80921',
  },
  appointment_date: '2026-04-23',
  start_time: '13:00',
  line_items: [
    {
      service_id: 'dc74c110-5a3a-4470-90f8-889d534a6e6c', // Sectional LF (cloth) - $15
      quantity: 15.5,
    },
  ],
  booking_mode: 'direct',
  booking_channel: 'lsa_sms',
  source_label: 'Google LSA',
  lead_source: 'Google LSA',
  actor_label: 'Claude API Booking',
  admin_heading: 'LSA Booking',
}

console.log('Booking Katie Santiago through proper system...\n')

// Get auth token
const { data: { session } } = await supabase.auth.getSession()

const response = await fetch('http://localhost:3000/api/admin/ops/bookings/create', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  },
  body: JSON.stringify(bookingData),
})

const result = await response.json()

if (!response.ok) {
  console.error('❌ Booking failed:', result)
  process.exit(1)
}

console.log('✅ KATIE BOOKED PROPERLY!')
console.log('='.repeat(70))
console.log(JSON.stringify(result, null, 2))
