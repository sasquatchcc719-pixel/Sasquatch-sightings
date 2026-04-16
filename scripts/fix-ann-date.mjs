import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fixAnnDate() {
  // Find Ann's appointment
  const { data: appointments } = await supabase
    .from('ops_appointments')
    .select('*, ops_customers!inner(*)')
    .eq('ops_customers.phone', '+17203193352')
    .eq('appointment_date', '2026-04-21')
    .eq('status', 'booked')

  if (!appointments || appointments.length === 0) {
    console.log('❌ No appointment found for Ann on 2026-04-21')
    return
  }

  const appointment = appointments[0]
  console.log(`Found appointment: ${appointment.id}`)
  console.log(`Current date: ${appointment.appointment_date} (Tuesday)`)
  console.log(`Changing to: 2026-04-20 (Monday)`)

  // Update to Monday April 20
  const { error } = await supabase
    .from('ops_appointments')
    .update({
      appointment_date: '2026-04-20',
      updated_at: new Date().toISOString(),
    })
    .eq('id', appointment.id)

  if (error) {
    console.error('❌ Error:', error)
    return
  }

  // Add status event
  await supabase.from('ops_appointment_status_events').insert({
    appointment_id: appointment.id,
    from_status: 'booked',
    to_status: 'booked',
    notes: 'Date corrected from Tuesday 4/21 to Monday 4/20 per customer request',
  })

  console.log('✅ Updated appointment to Monday April 20, 2026')
  console.log('✅ Ann Biebel - Monday 4/20/26 at 11:00 AM')
}

fixAnnDate()
