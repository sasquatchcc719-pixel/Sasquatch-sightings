import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function fixToddStatus() {
  // Find Todd's appointment on Monday
  const { data: appointments, error: findError } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      appointment_date,
      start_time,
      status,
      ops_customers!ops_appointments_customer_id_fkey!inner(first_name, last_name)
    `,
    )
    .ilike('ops_customers.first_name', '%Todd%')
    .gte('appointment_date', new Date().toISOString().split('T')[0])
    .order('appointment_date')
    .limit(5)

  if (findError) {
    console.error('Error finding appointment:', findError)
    return
  }

  if (!appointments || appointments.length === 0) {
    console.log('No upcoming appointments found for Todd')
    return
  }

  console.log('Found appointments:')
  appointments.forEach((a) => {
    const customer = a.ops_customers as any
    console.log(
      `  - ${a.appointment_date} ${a.start_time} | Status: ${a.status} | ${customer.first_name} ${customer.last_name}`,
    )
  })

  const onMyWay = appointments.find((a) => a.status === 'on_my_way')

  if (!onMyWay) {
    console.log('\n❌ No appointments currently in "on_my_way" status')
    return
  }

  console.log(`\n🔄 Changing status from "on_my_way" to "booked"`)
  console.log(`   Date: ${onMyWay.appointment_date}`)
  console.log(`   Time: ${onMyWay.start_time}`)

  // Update status back to booked
  const { error: updateError } = await supabase
    .from('ops_appointments')
    .update({ status: 'booked' })
    .eq('id', onMyWay.id)

  if (updateError) {
    console.error('Error updating:', updateError)
    return
  }

  // Add status event
  await supabase.from('ops_appointment_status_events').insert({
    appointment_id: onMyWay.id,
    from_status: 'on_my_way',
    to_status: 'booked',
    notes: 'Accidentally triggered - reset by Claude',
  })

  console.log('\n✅ Status changed back to "booked" - clock stopped!')
}

fixToddStatus()
