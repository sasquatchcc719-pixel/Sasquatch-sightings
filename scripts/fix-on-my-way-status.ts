import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function fixStatus() {
  // Find all "on_my_way" appointments
  const { data: appointments, error: findError } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      appointment_date,
      start_time,
      status,
      ops_customers!ops_appointments_customer_id_fkey(first_name, last_name)
    `,
    )
    .eq('status', 'on_my_way')
    .gte('appointment_date', new Date().toISOString().split('T')[0])
    .order('appointment_date')

  if (findError) {
    console.error('Error finding appointments:', findError)
    return
  }

  if (!appointments || appointments.length === 0) {
    console.log('✅ No appointments currently in "on_my_way" status')
    return
  }

  console.log(
    `Found ${appointments.length} appointment(s) in "on_my_way" status:\n`,
  )

  for (const appt of appointments) {
    const customer = appt.ops_customers as any
    console.log(`📍 ${appt.appointment_date} at ${appt.start_time}`)
    console.log(`   Customer: ${customer.first_name} ${customer.last_name}`)
    console.log(`   Status: ${appt.status}`)
    console.log(`   🔄 Changing to "booked"...`)

    // Update status back to booked
    const { error: updateError } = await supabase
      .from('ops_appointments')
      .update({ status: 'booked' })
      .eq('id', appt.id)

    if (updateError) {
      console.error('   ❌ Error updating:', updateError)
      continue
    }

    // Add status event
    await supabase.from('ops_appointment_status_events').insert({
      appointment_id: appt.id,
      from_status: 'on_my_way',
      to_status: 'booked',
      notes: 'Accidentally triggered - reset by Claude',
    })

    console.log(`   ✅ Reset to "booked"\n`)
  }

  console.log('Done!')
}

fixStatus()
