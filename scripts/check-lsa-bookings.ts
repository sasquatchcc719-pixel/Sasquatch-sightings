import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function checkLSABookings() {
  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('ops_appointments')
    .select(
      'id, appointment_date, lead_source, created_at, ops_customers!ops_appointments_customer_id_fkey(full_name)',
    )
    .eq('lead_source', 'Google LSA')
    .gte('created_at', `${today}T00:00:00`)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error:', error)
    process.exit(1)
  }

  console.log(`\nGoogle LSA bookings today (${today}):`)
  console.log(`Total: ${data?.length || 0}\n`)

  if (data && data.length > 0) {
    data.forEach((appt) => {
      const customer = Array.isArray(appt.ops_customers)
        ? appt.ops_customers[0]
        : appt.ops_customers
      console.log(
        `- ${customer?.full_name || 'Unknown'} - Appointment: ${appt.appointment_date}`,
      )
      console.log(`  Created: ${new Date(appt.created_at).toLocaleString()}`)
      console.log(`  ID: ${appt.id}\n`)
    })
  }
}

checkLSABookings()
