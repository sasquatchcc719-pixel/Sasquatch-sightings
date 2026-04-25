import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function checkEvan() {
  const { data: appointments } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      appointment_date,
      start_time,
      end_time,
      quoted_total,
      status,
      created_at,
      ops_customers!ops_appointments_customer_id_fkey(first_name, last_name),
      ops_appointment_line_items(name_snapshot, quantity, unit_price, line_total)
    `,
    )
    .ilike('ops_customers.first_name', '%Evan%')
    .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(3)

  if (!appointments || appointments.length === 0) {
    console.log('No recent appointments found for Evan')
    return
  }

  for (const appt of appointments) {
    const customer = appt.ops_customers as any
    console.log(`\n📅 ${customer.first_name} ${customer.last_name}`)
    console.log(`   Date: ${appt.appointment_date}`)
    console.log(`   Time: ${appt.start_time} - ${appt.end_time}`)

    // Calculate duration
    const [sh, sm] = appt.start_time.split(':').map(Number)
    const [eh, em] = appt.end_time.split(':').map(Number)
    const durationMins = eh * 60 + em - (sh * 60 + sm)
    const durationHours = durationMins / 60

    console.log(`   Duration: ${durationMins} minutes (${durationHours} hours)`)
    console.log(`   Total: $${appt.quoted_total}`)
    console.log(`   Created: ${new Date(appt.created_at).toLocaleString()}`)
    console.log(`\n   Line items:`)

    if (appt.ops_appointment_line_items) {
      for (const item of appt.ops_appointment_line_items) {
        console.log(
          `     - ${item.name_snapshot} x${item.quantity} @ $${item.unit_price} = $${item.line_total}`,
        )
      }
    }
  }
}

checkEvan()
