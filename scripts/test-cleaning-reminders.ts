/**
 * Integration test for the cleaning-reminder engine against the REAL database.
 * SMS sending is stubbed, so no customer is ever texted by this script.
 * Every row it creates is deleted at the end.
 *
 *   pnpm tsx scripts/test-cleaning-reminders.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import {
  addMonths,
  buildConfirmationMessage,
  buildReminderMessage,
  cancelCleaningReminder,
  getReminderForAppointment,
  isWithinSendWindow,
  processDueCleaningReminders,
  scheduledForInterval,
  setCleaningReminder,
} from '../src/lib/ops/cleaning-reminders'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const sent: Array<{ phone: string; message: string }> = []
const stubSms = async (phone: string, message: string) => {
  sent.push({ phone, message })
  return { sid: `STUB${sent.length}` }
}

let pass = 0
let fail = 0
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ✅ ${label}`)
    pass += 1
  } else {
    console.log(`  ❌ ${label}`, detail ?? '')
    fail += 1
  }
}

async function main() {
  console.log('\n── Pure date math ──')
  const jan31 = new Date('2026-01-31T16:00:00Z')
  check(
    'Jan 31 + 1 month clamps to Feb 28 (no March overflow)',
    addMonths(jan31, 1).toISOString().startsWith('2026-02-28'),
    addMonths(jan31, 1).toISOString(),
  )
  const sixOut = scheduledForInterval(6, new Date('2026-08-11T20:00:00Z'))
  check(
    '6 months out lands in Feb 2027',
    sixOut.toISOString().startsWith('2027-02-11'),
    sixOut.toISOString(),
  )
  check(
    'send window rejects 3am MT',
    !isWithinSendWindow(new Date('2026-08-11T09:00:00Z')),
  )
  check(
    'send window accepts 11am MT (the cron slot)',
    isWithinSendWindow(new Date('2026-08-11T17:00:00Z')),
  )
  check(
    'send window accepts 10am MT (winter cron slot)',
    isWithinSendWindow(new Date('2026-12-11T17:00:00Z')),
  )

  console.log('\n── Message copy ──')
  const who = { first_name: 'Sarah', full_name: 'Sarah Jones' }
  const confirmation = buildConfirmationMessage(who, 6, sixOut)
  const reminder = buildReminderMessage(
    who,
    6,
    new Date('2026-08-11T20:00:00Z'),
  )
  console.log(`  confirmation: ${confirmation}`)
  console.log(`  reminder:     ${reminder}`)
  check('confirmation names the month', confirmation.includes('February 2027'))
  check('reminder explains when they asked', reminder.includes('August 2026'))
  check('reminder carries the booking link', reminder.includes('/rebook'))
  check('reminder states the $200 floor', reminder.includes('$200+'))

  console.log('\n── Promo math against the real promo_codes rows ──')
  const { data: tiers } = await supabase
    .from('promo_code_tiers')
    .select('min_spend, discount_amount, promo_codes!inner(code)')
    .eq('promo_codes.code', 'REMIND20')
  const tier = tiers?.[0]
  check('REMIND20 exists with one tier', !!tier, tiers)
  check('threshold is $200', Number(tier?.min_spend) === 200)
  check('discount is $20', Number(tier?.discount_amount) === 20)

  console.log('\n── Live round-trip on a real appointment ──')
  const { data: appt } = await supabase
    .from('ops_appointments')
    .select(
      'id, customer_id, ops_customers!ops_appointments_customer_id_fkey(full_name, phone)',
    )
    .not('customer_id', 'is', null)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!appt) {
    console.log('  ⚠️  no completed appointment found — skipping live test')
  } else {
    const customer = Array.isArray(appt.ops_customers)
      ? appt.ops_customers[0]
      : appt.ops_customers
    console.log(`  using appointment ${appt.id} (${customer?.full_name})`)

    const result = await setCleaningReminder(supabase, {
      appointmentId: appt.id,
      months: 6,
      sendSms: stubSms,
    })
    check('reminder created', !!result.reminderId)
    check('confirmation "sent" via stub', result.confirmationSent)
    check('exactly one stub text so far', sent.length === 1, sent.length)

    const found = await getReminderForAppointment(supabase, appt.id)
    check('reminder reads back as pending', found?.id === result.reminderId)
    check('interval persisted as 6', found?.interval_months === 6)

    // Re-tap a different interval — must replace, not stack.
    const second = await setCleaningReminder(supabase, {
      appointmentId: appt.id,
      months: 12,
      sendSms: stubSms,
    })
    const { data: live } = await supabase
      .from('cleaning_reminders')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('status', 'pending')
    check(
      're-tap leaves exactly one live reminder',
      live?.length === 1,
      live?.length,
    )
    check('the live one is the newest', live?.[0]?.id === second.reminderId)

    // Nothing due yet — the sender must not touch a future reminder.
    const noneDue = await processDueCleaningReminders(supabase, {
      sendSms: stubSms,
      notifyOwner: async () => {},
      now: new Date('2026-08-11T17:00:00Z'),
    })
    check('future reminder is not sent early', noneDue.sent === 0, noneDue)

    // Outside the window it must defer rather than send.
    const deferred = await processDueCleaningReminders(supabase, {
      sendSms: stubSms,
      notifyOwner: async () => {},
      now: new Date('2026-08-12T09:00:00Z'),
    })
    check('3am MT run defers', deferred.deferred === true, deferred)

    // Force it due, then confirm it actually sends.
    await supabase
      .from('cleaning_reminders')
      .update({ scheduled_for: new Date('2026-08-10T16:00:00Z').toISOString() })
      .eq('id', second.reminderId)

    const before = sent.length
    const dueRun = await processDueCleaningReminders(supabase, {
      sendSms: stubSms,
      notifyOwner: async () => {},
      now: new Date('2026-08-11T17:00:00Z'),
    })
    const { data: after } = await supabase
      .from('cleaning_reminders')
      .select('status, sent_at, message')
      .eq('id', second.reminderId)
      .maybeSingle()

    // The customer may legitimately have been serviced again since — that is a
    // correct skip, not a failure, so accept either outcome explicitly.
    if (after?.status === 'skipped') {
      console.log(
        '  ℹ️  skipped (customer serviced again since) — guard working',
      )
      check('skip left no text sent', sent.length === before)
    } else {
      check('due reminder marked sent', after?.status === 'sent', after?.status)
      check('sent_at stamped', !!after?.sent_at)
      check('message archived on the row', !!after?.message)
      check('exactly one text went out', sent.length === before + 1)
      check('sender reported 1 sent', dueRun.sent === 1, dueRun)
    }

    // Cancel path.
    const third = await setCleaningReminder(supabase, {
      appointmentId: appt.id,
      months: 3,
      sendSms: stubSms,
    })
    await cancelCleaningReminder(supabase, third.reminderId)
    const gone = await getReminderForAppointment(supabase, appt.id)
    check('cancelled reminder no longer reads as pending', gone === null, gone)

    // Cleanup — remove every row this script created.
    const { error: cleanupError } = await supabase
      .from('cleaning_reminders')
      .delete()
      .eq('appointment_id', appt.id)
    check('test rows cleaned up', !cleanupError, cleanupError)
  }

  console.log(`\n── ${pass} passed, ${fail} failed ──`)
  console.log(`(${sent.length} texts captured by the stub, 0 sent for real)\n`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
