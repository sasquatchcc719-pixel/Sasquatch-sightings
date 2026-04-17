import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

async function test() {
  const { data: customerData } = await supabase.from('ops_customers').select('id').limit(1)
  const customerId = customerData[0].id

  const { data: addressData } = await supabase.from('ops_service_addresses').select('id').eq('customer_id', customerId).limit(1)
  const addressId = addressData[0]?.id || null

  const appointmentDate = '2026-04-17'
  const startTime = '09:00:00'
  const endTime = '09:30:00'

  const { data, error } = await supabase
    .from('ops_appointments')
    .insert({
      customer_id: customerId,
      service_address_id: addressId,
      appointment_date: appointmentDate,
      start_time: startTime,
      end_time: endTime,
      status: 'booked',
      payment_status: 'unpaid',
      booking_channel: 'admin',
      source: 'internal',
      kind: 'estimate',
      estimate_status: 'draft',
      quickbooks_sync_status: 'not_synced',
      quoted_total: 0,
      internal_notes: null,
    })
    .select('id')
    .single()

  console.log('Error:', error)
  console.log('Data:', data)
}

test()
