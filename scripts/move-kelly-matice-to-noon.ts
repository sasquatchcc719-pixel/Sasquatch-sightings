/** One-off: Kelly Matice 2026-05-11 → 12:00–14:00. pnpm tsx scripts/move-kelly-matice-to-noon.ts */
import dotenv from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

type ScriptSupabase = SupabaseClient<any, 'public', any>

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env')

  const supabase = createClient(url, key) as ScriptSupabase

  let custId: string | null = null
  const { data: byPhone } = await supabase
    .from('ops_customers')
    .select('id')
    .eq('phone', '+17193304946')
    .maybeSingle()
  if (byPhone?.id) custId = byPhone.id

  if (!custId) {
    const { data: byName } = await supabase
      .from('ops_customers')
      .select('id')
      .ilike('first_name', 'kelly')
      .ilike('last_name', 'matice')
      .limit(1)
      .maybeSingle()
    if (byName?.id) custId = byName.id
  }

  if (!custId) throw new Error('Kelly Matice customer not found')

  const { data: rows, error } = await supabase
    .from('ops_appointments')
    .update({
      start_time: '12:00:00',
      end_time: '14:00:00',
      internal_notes:
        'HCP import wk 5/10–16. Mon 5/11 12:00–2:00 PM. Job #18046. Subtotal $313 tax $0. (Time adjusted from HCP.)',
      updated_at: new Date().toISOString(),
    })
    .eq('customer_id', custId)
    .eq('appointment_date', '2026-05-11')
    .select('id')

  if (error) throw error
  const appt = rows?.[0]
  if (!appt?.id)
    throw new Error('Appointment not found for Kelly on 2026-05-11')
  console.log('OK — Kelly Matice moved to 12:00–14:00, appt', appt.id)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
