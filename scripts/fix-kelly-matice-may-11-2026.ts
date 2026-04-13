/**
 * One-off: correct Kelly Matice from HCP screenshot (was placeholder phone + AM time).
 * Run: pnpm tsx scripts/fix-kelly-matice-may-11-2026.ts
 */
import dotenv from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

type ScriptSupabase = SupabaseClient<any, 'public', any>

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env')

  const supabase = createClient(url, key) as ScriptSupabase
  const wrongPhone = normalizePhone('719-555-0199')
  const rightPhone = normalizePhone('719-330-4946')

  const { data: cust, error: cErr } = await supabase
    .from('ops_customers')
    .select('id')
    .eq('phone', wrongPhone)
    .maybeSingle()

  if (cErr) throw cErr
  if (!cust?.id) {
    const { data: byName } = await supabase
      .from('ops_customers')
      .select('id')
      .ilike('last_name', 'matice')
      .limit(1)
      .maybeSingle()
    if (!byName?.id) {
      console.error(
        'Kelly Matice customer not found (placeholder phone or name).',
      )
      process.exit(1)
    }
    await supabase
      .from('ops_customers')
      .update({
        phone: rightPhone,
        email: 'kelly.mattice333@gmail.com',
        updated_at: new Date().toISOString(),
      })
      .eq('id', byName.id)
    await fixAddressAndAppointment(supabase, byName.id)
    console.log('Updated Kelly (found by last name).')
    return
  }

  await supabase
    .from('ops_customers')
    .update({
      phone: rightPhone,
      email: 'kelly.mattice333@gmail.com',
      updated_at: new Date().toISOString(),
    })
    .eq('id', cust.id)

  await fixAddressAndAppointment(supabase, cust.id)
  console.log(
    'Updated Kelly Matice: phone, email, address, appointment 9pm–11pm.',
  )
}

async function fixAddressAndAppointment(
  supabase: ScriptSupabase,
  customerId: string,
) {
  const { data: addresses } = await supabase
    .from('ops_service_addresses')
    .select('id')
    .eq('customer_id', customerId)

  const addrId = addresses?.[0]?.id
  if (addrId) {
    await supabase
      .from('ops_service_addresses')
      .update({
        street_1: '2088 Turnbull Dr',
        city: 'Colorado Springs',
        state: 'CO',
        zip_code: '80921',
        updated_at: new Date().toISOString(),
      })
      .eq('id', addrId)
  }

  const { data: appts } = await supabase
    .from('ops_appointments')
    .select('id')
    .eq('customer_id', customerId)
    .eq('appointment_date', '2026-05-11')

  const apptId = appts?.[0]?.id
  if (apptId) {
    await supabase
      .from('ops_appointments')
      .update({
        start_time: '21:00:00',
        end_time: '23:00:00',
        internal_notes:
          'HCP import wk 5/10–16. Mon 5/11 9:00 PM–11:00 PM MDT (corrected from AM). Job #18046. Subtotal $313.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', apptId)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
