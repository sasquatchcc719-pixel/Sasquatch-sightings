/**
 * Verifies the reminder buttons authorize correctly for BOTH staff members:
 * Charles (owner) and David (tech). Read-only — creates nothing.
 *
 *   pnpm tsx scripts/test-reminder-access.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { getTechAppointmentForAccess } from '../src/lib/tech/appointments'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(ok ? `  ✅ ${label}` : `  ❌ ${label}`, ok ? '' : (detail ?? ''))
  ok ? (pass += 1) : (fail += 1)
}

/** Mirrors canAccessAppointment() in the reminders route. */
async function canAccess(
  role: string,
  staffId: string,
  appointmentId: string,
): Promise<boolean> {
  if (role === 'admin' || role === 'owner') return true
  const appt = await getTechAppointmentForAccess(supabase, {
    role,
    staffId,
    appointmentId,
  })
  return !!appt
}

async function main() {
  const { data: staff } = await supabase
    .from('staff_users')
    .select('id, display_name, role')
  const charles = staff!.find((s) => s.role === 'owner')!
  const david = staff!.find((s) => s.role === 'tech')!
  console.log(`\nCharles: ${charles.id} (${charles.role})`)
  console.log(`David:   ${david.id} (${david.role})\n`)

  const pick = async (staffId: string) => {
    const { data } = await supabase
      .from('ops_appointments')
      .select('id, customer_id')
      .eq('assigned_staff_user_id', staffId)
      .not('customer_id', 'is', null)
      .order('appointment_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data
  }

  const charlesJob = await pick(charles.id)
  const davidJob = await pick(david.id)
  console.log(`Charles' latest job: ${charlesJob?.id}`)
  console.log(`David's latest job:  ${davidJob?.id}\n`)

  console.log('── David (tech) ──')
  check(
    'can set a reminder on HIS OWN job',
    await canAccess(david.role, david.id, davidJob!.id),
  )
  check(
    "is BLOCKED from Charles' job (correct scoping)",
    !(await canAccess(david.role, david.id, charlesJob!.id)),
  )

  console.log('── Charles (owner) ──')
  check(
    'can set a reminder on his own job',
    await canAccess(charles.role, charles.id, charlesJob!.id),
  )
  check(
    "can also set one on DAVID's job (owner is unrestricted)",
    await canAccess(charles.role, charles.id, davidJob!.id),
  )

  console.log('\n── Customers reachable by phone ──')
  for (const [who, job] of [
    ['Charles', charlesJob],
    ['David', davidJob],
  ] as const) {
    const { data: c } = await supabase
      .from('ops_customers')
      .select('phone')
      .eq('id', job!.customer_id)
      .maybeSingle()
    check(`${who}'s job has a customer phone on file`, !!c?.phone)
  }

  console.log(`\n── ${pass} passed, ${fail} failed ──\n`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
