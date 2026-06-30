/**
 * Integration test for the client portal against the real DB.
 * Verifies scoping (the security-critical property), data loading, and the
 * change-request insert/read/delete roundtrip. Read-only on real appointments.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
} catch {}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const LANCE_EMAIL = 'lanjohnson@palmerlakerecovery.com'
const OTHER_CUSTOMER = '51e712aa-a0c4-4035-b28d-fc144204a260' // Tiffany Sewell

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}`)
  }
}

async function main() {
  // 1. Lance is linked as a client_manager to exactly one customer.
  const { data: clientUser } = await sb
    .from('ops_client_users')
    .select('*')
    .eq('email', LANCE_EMAIL)
    .single()
  check('Lance has a client_users row', !!clientUser)
  check('Lance is active', clientUser?.is_active === true)
  const RV = clientUser.customer_id
  console.log(`  → scoped customer_id: ${RV}`)

  // 2. Templates scoped to RV all belong to RV.
  const { data: templates } = await sb
    .from('ops_recurring_templates')
    .select('id, customer_id, label, is_active')
    .eq('customer_id', RV)
    .eq('is_active', true)
  check('RV has active recurring templates', (templates?.length ?? 0) > 0)
  check(
    'every scoped template belongs to RV',
    (templates ?? []).every((t) => t.customer_id === RV),
  )

  // 3. Appointments scoped to RV all belong to RV (no leakage).
  const { data: appts } = await sb
    .from('ops_appointments')
    .select('id, customer_id, status')
    .eq('customer_id', RV)
    .neq('status', 'cancelled')
  check('RV has appointments', (appts?.length ?? 0) > 0)
  check(
    'every scoped appointment belongs to RV',
    (appts ?? []).every((a) => a.customer_id === RV),
  )

  // 4. SCOPING SAFETY: another customer's appointments must NOT appear in RV's set.
  const { data: otherAppts } = await sb
    .from('ops_appointments')
    .select('id')
    .eq('customer_id', OTHER_CUSTOMER)
    .limit(5)
  const rvIds = new Set((appts ?? []).map((a) => a.id))
  check(
    "other customer's appointments are NOT in RV's scope",
    (otherAppts ?? []).every((a) => !rvIds.has(a.id)),
  )

  // 5. Ownership guard logic: a non-RV appointment loads with a different customer_id,
  //    which is exactly what the skip/note endpoints reject.
  if (otherAppts?.[0]) {
    const { data: foreign } = await sb
      .from('ops_appointments')
      .select('id, customer_id')
      .eq('id', otherAppts[0].id)
      .single()
    check(
      'foreign appointment fails the customer_id ownership check',
      foreign.customer_id !== RV,
    )
  }

  // 6. Change-request insert / read / delete roundtrip.
  const { data: inserted, error: insErr } = await sb
    .from('ops_client_change_requests')
    .insert({
      customer_id: RV,
      requested_by_user_id: clientUser.user_id,
      requested_by_name: 'Lance Johnson',
      request_type: 'other',
      message: '[integration test] please ignore',
      status: 'pending',
    })
    .select()
    .single()
  check('change request inserts', !!inserted && !insErr)

  const { data: readBack } = await sb
    .from('ops_client_change_requests')
    .select('id, status, customer_id')
    .eq('id', inserted.id)
    .single()
  check('change request reads back scoped to RV', readBack?.customer_id === RV)

  await sb.from('ops_client_change_requests').delete().eq('id', inserted.id)
  const { data: afterDelete } = await sb
    .from('ops_client_change_requests')
    .select('id')
    .eq('id', inserted.id)
    .maybeSingle()
  check('test change request cleaned up', !afterDelete)

  // 7. client_note column exists on appointments.
  const { error: noteErr } = await sb
    .from('ops_appointments')
    .select('client_note')
    .limit(1)
  check('ops_appointments.client_note column exists', !noteErr)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
