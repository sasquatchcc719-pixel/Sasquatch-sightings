import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function checkActivity() {
  // Check recent SMS (last 3 hours)
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()

  const { data: sms, error: smsError } = await supabase
    .from('ops_sms_messages')
    .select(
      `
      direction,
      body,
      status,
      created_at,
      ops_customers!ops_sms_messages_customer_id_fkey (
        phone,
        full_name
      )
    `,
    )
    .gte('created_at', threeHoursAgo)
    .order('created_at', { ascending: false })
    .limit(50)

  if (smsError) {
    console.error('SMS Error:', smsError)
  } else {
    console.log('\n=== RECENT SMS (last 3 hours) ===\n')
    sms?.forEach((msg) => {
      const customer = Array.isArray(msg.ops_customers)
        ? msg.ops_customers[0]
        : msg.ops_customers
      console.log(
        `${new Date(msg.created_at).toLocaleTimeString()} - ${customer?.full_name} (${customer?.phone})`,
      )
      console.log(
        `  ${msg.direction.toUpperCase()}: ${msg.body?.slice(0, 100)}...`,
      )
      console.log(`  Status: ${msg.status}\n`)
    })
  }

  // Check recent Google LSA appointments (last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: appts, error: apptsError } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      appointment_date,
      lead_source,
      created_at,
      status,
      ops_customers!ops_appointments_customer_id_fkey (
        full_name,
        phone
      ),
      ops_invoices (
        total,
        status
      )
    `,
    )
    .eq('lead_source', 'Google LSA')
    .gte('created_at', oneDayAgo)
    .order('created_at', { ascending: false })

  if (apptsError) {
    console.error('Appointments Error:', apptsError)
  } else {
    console.log('\n=== GOOGLE LSA APPOINTMENTS (last 24 hours) ===\n')
    appts?.forEach((appt) => {
      const customer = Array.isArray(appt.ops_customers)
        ? appt.ops_customers[0]
        : appt.ops_customers
      const invoice = Array.isArray(appt.ops_invoices)
        ? appt.ops_invoices[0]
        : appt.ops_invoices

      console.log(`${customer?.full_name} - ${customer?.phone}`)
      console.log(`  Appointment: ${appt.appointment_date}`)
      console.log(`  Created: ${new Date(appt.created_at).toLocaleString()}`)
      console.log(`  Status: ${appt.status}`)
      console.log(`  Invoice Total: $${invoice?.total || 0}`)
      console.log(`  ID: ${appt.id}\n`)
    })
  }
}

checkActivity()
