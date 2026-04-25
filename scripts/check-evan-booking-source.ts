import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function check() {
  const { data } = await supabase
    .from('ops_appointments')
    .select('id, booking_channel, source, lead_source')
    .ilike('ops_customers.first_name', '%Evan%')
    .eq('appointment_date', '2026-04-25')
    .single()

  if (!data) {
    const { data: all } = await supabase
      .from('ops_appointments')
      .select(
        `
        id, 
        booking_channel, 
        source, 
        lead_source,
        ops_customers!ops_appointments_customer_id_fkey(first_name, last_name)
      `,
      )
      .eq('appointment_date', '2026-04-25')
      .gte(
        'created_at',
        new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      )

    const evan = all?.find((a) => {
      const c = a.ops_customers as any
      return c.first_name.toLowerCase().includes('evan')
    })

    if (evan) {
      console.log('Booking channel:', evan.booking_channel)
      console.log('Source:', evan.source)
      console.log('Lead source:', evan.lead_source)
    }
    return
  }

  console.log('Booking channel:', data.booking_channel)
  console.log('Source:', data.source)
  console.log('Lead source:', data.lead_source)
}

check()
