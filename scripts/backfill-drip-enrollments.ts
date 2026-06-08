import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { enrollCustomerInDrip } from '@/lib/ops/drip-campaign'

dotenv.config({ path: '.env.local' })

async function main() {
  const apply = process.argv.includes('--apply')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase credentials')
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: appointments, error } = await supabase
    .from('ops_appointments')
    .select('id, customer_id, appointment_date, completed_at')
    .eq('status', 'completed')
    .is('recurring_template_id', null)
    .order('appointment_date', { ascending: false })
    .order('completed_at', { ascending: false })

  if (error) throw error

  const latestByCustomer = new Map<string, { id: string }>()
  for (const appointment of appointments || []) {
    if (!latestByCustomer.has(appointment.customer_id)) {
      latestByCustomer.set(appointment.customer_id, appointment)
    }
  }

  console.log(
    `${apply ? 'Applying' : 'Previewing'} drip recovery for ${latestByCustomer.size} customers.`,
  )

  if (apply) {
    for (const appointment of latestByCustomer.values()) {
      await enrollCustomerInDrip(appointment.id)
    }
    console.log('Drip recovery complete.')
  } else {
    console.log('No changes made. Run with --apply to create the schedules.')
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
