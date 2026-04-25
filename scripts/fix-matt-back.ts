import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function fixMatt() {
  const { data: appt } = await supabase
    .from('ops_appointments')
    .select('id')
    .eq('appointment_date', '2026-04-25')
    .eq('start_time', '09:00:00')
    .ilike('ops_customers.first_name', '%Matt%')
    .single()

  if (!appt) {
    // Try direct query
    const { data: appointments } = await supabase
      .from('ops_appointments')
      .select(
        `
        id,
        ops_customers!ops_appointments_customer_id_fkey(first_name, last_name)
      `,
      )
      .eq('appointment_date', '2026-04-25')
      .eq('start_time', '09:00:00')

    const mattAppt = appointments?.find((a) => {
      const customer = a.ops_customers as any
      return customer.first_name.toLowerCase().includes('matt')
    })

    if (!mattAppt) {
      console.log('Could not find Matt appointment')
      return
    }

    await supabase
      .from('ops_appointments')
      .update({ status: 'on_my_way' })
      .eq('id', mattAppt.id)

    await supabase.from('ops_appointment_status_events').insert({
      appointment_id: mattAppt.id,
      from_status: 'booked',
      to_status: 'on_my_way',
      notes: 'Restored - Charles is actively on his way',
    })

    console.log('✅ Matt Schroeder back to "on_my_way"')
    return
  }

  await supabase
    .from('ops_appointments')
    .update({ status: 'on_my_way' })
    .eq('id', appt.id)

  await supabase.from('ops_appointment_status_events').insert({
    appointment_id: appt.id,
    from_status: 'booked',
    to_status: 'on_my_way',
    notes: 'Restored - Charles is actively on his way',
  })

  console.log('✅ Matt Schroeder back to "on_my_way"')
}

fixMatt()
