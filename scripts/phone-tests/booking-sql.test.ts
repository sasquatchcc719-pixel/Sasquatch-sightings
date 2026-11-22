// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

const sid = 'CA' + 'a'.repeat(32)
const secondSid = 'CA' + 'b'.repeat(32)
const hash = 'c'.repeat(64)
const tech = '20000000-0000-4000-8000-000000000001'
const service = '30000000-0000-4000-8000-000000000001'
const contact = {
  first_name: 'Fixture',
  last_name: 'Caller',
  phone: '+12025550101',
  email: 'caller@example.test',
}
const address = {
  street_1: '1 Sample St',
  city: 'Monument',
  state: 'CO',
  zip_code: '80132',
}
const plan = {
  customer: contact,
  address,
  appointment_date: '2099-02-04',
  start_time: '15:00',
  end_time: '18:00',
  assigned_staff_user_id: tech,
  appointment_status: 'booked',
  subtotal: 230,
  service_subtotal: 230,
  total: 230,
  discount_applied: 0,
  expected_caller_sequence: 3,
  sync_status: 'held',
  lead_source: { lead_source: 'Other', lead_source_key: 'other' },
  line_items: [
    {
      service_catalog_item_id: service,
      name_snapshot: 'Room',
      quantity: 5,
      unit_price: 46,
      line_total: 230,
      duration_minutes: 10,
      pricing_unit: 'fixed',
    },
  ],
}
const measurement = {
  customer: { ...contact, business_name: 'Fixture Offices' },
  address,
  staff_id: tech,
  date: plan.appointment_date,
  time: plan.start_time,
  description: 'Measure upstairs hall',
  expected_caller_sequence: 3,
}

const db = new PGlite()
const sql = (path: string) => readFileSync(path, 'utf8')
async function save(
  callSid = sid,
  changes: Record<string, unknown> = {},
  key = hash,
) {
  const { rows } = await db.query<{ token: string }>(
    'select phone_booking_calendar_version($1,$2) as token',
    [plan.appointment_date, plan.customer],
  )
  return (
    await db.query<{ receipt: { appointment_id: string; replayed?: boolean } }>(
      'select save_phone_booking($1,$2,$3) as receipt',
      [callSid, key, { ...plan, calendar_version: rows[0].token, ...changes }],
    )
  ).rows[0].receipt
}
async function version() {
  return (
    await db.query<{ version: string }>(
      'select phone_booking_calendar_version($1,$2) as version',
      [measurement.date, measurement.customer],
    )
  ).rows[0].version
}
async function measure(
  token: string,
  changes: Record<string, unknown> = {},
  key = hash,
) {
  return (
    await db.query<{
      receipt: { appointment_id: string; confirmation_number: string }
    }>('select create_phone_measurement($1,$2,$3,$4) as receipt', [
      sid,
      key,
      { ...measurement, ...changes },
      token,
    ])
  ).rows[0].receipt
}
async function counts() {
  return (
    await db.query(
      'select (select count(*)::int from ops_appointments) as jobs,(select count(*)::int from ops_invoices) as invoices,(select count(*)::int from ops_communication_queue) as emails',
    )
  ).rows[0]
}
beforeAll(async () => {
  const fixture = sql(
    'supabase/tests/mcp_operation_controls_fixture.sql',
  ).split('-- APPLY_MCP_OPERATION_CONTROLS_MIGRATION_HERE')[0]
  // PGlite has PostgreSQL's built-in gen_random_uuid; it does not read psql directives.
  await db.exec(
    fixture
      .replace('\\set ON_ERROR_STOP on', '')
      .replace('create extension if not exists pgcrypto;', ''),
  )
  await db.exec(sql('scripts/phone-tests/booking-fixture.sql'))
  for (const migration of [
    'add_mcp_operation_controls',
    'outreach_measuring_bridge',
    'phone_assistant_sessions',
    'atomic_phone_booking',
    'guard_phone_customer_matches',
    'phone_booking_calendar_lock',
    'queue_phone_booking_confirmations',
    'atomic_phone_measurement',
  ]) {
    const names = readdirSync('supabase/migrations').filter((name) =>
      name.endsWith('_' + migration + '.sql'),
    )
    expect(names, 'unique migration for ' + migration).toHaveLength(1)
    await db.exec(sql('supabase/migrations/' + names[0]))
  }
}, 30_000)
beforeEach(async () => {
  await db.exec('begin')
  for (const callSid of [sid, secondSid]) {
    await db.query(
      'insert into phone_assistant_sessions(call_sid,caller_phone,provider_call_id,pilot,answered_at) values ($1,$2,$1,false,now())',
      [callSid, contact.phone],
    )
    await db.query(
      "insert into phone_assistant_transcript(call_sid,sequence,role,content) values($1,3,'user','Yes, book it.')",
      [callSid],
    )
  }
})
afterEach(async () => {
  await db.exec('rollback')
})
afterAll(async () => {
  await db.close()
})

describe('real phone booking transactions', () => {
  it('reuses a formatted legacy contact and returns one job, invoice and email across retries', async () => {
    await db.query(
      "insert into ops_customers(first_name,last_name,full_name,phone) values ('Fixture','Caller','Fixture Caller','(202) 555-0101')",
    )
    const first = await save()
    await db.query(
      'update phone_assistant_sessions set ended_at = now() where call_sid=$1',
      [sid],
    )
    expect(await save()).toMatchObject({
      appointment_id: first.appointment_id,
      replayed: true,
    })
    expect(await counts()).toEqual({ jobs: 1, invoices: 1, emails: 1 })
    expect(
      (await db.query('select phone,email from ops_customers')).rows,
    ).toEqual([{ phone: contact.phone, email: contact.email }])
    expect(
      (await db.query('select payload from ops_communication_queue')).rows[0]
        .payload,
    ).toMatchObject({
      origin: 'phone_booking',
      to: contact.email,
      date: plan.appointment_date,
      time: plan.start_time,
      total: plan.total,
    })
  })
  it('rejects stale speech, conflicting repeat calls, changed receipts and parked jobs', async () => {
    // Each expected rejection uses its own savepoint so later assertions run in the same test transaction.
    const reject = async (
      operation: () => Promise<unknown>,
      pattern: RegExp,
    ) => {
      await db.exec('savepoint rejected')
      await expect(operation()).rejects.toThrow(pattern)
      await db.exec('rollback to savepoint rejected')
    }
    await reject(
      () => save(sid, { expected_caller_sequence: 2 }),
      /spoken again/,
    )
    await save()
    await reject(() => save(secondSid), /overlapping/)
    await reject(() => save(sid, { start_time: '14:00' }), /requires review/)
    await reject(() => save(sid, {}, 'd'.repeat(64)), /requires review/)
    await db.exec('update ops_appointments set parked_at=now()')
    await reject(() => save(), /requires review/)
    expect(await counts()).toEqual({ jobs: 1, invoices: 1, emails: 1 })
  })
  it('rejects a residential calendar snapshot after an office edit', async () => {
    const { rows } = await db.query<{ token: string }>(
      'select phone_booking_calendar_version($1,$2) as token',
      [plan.appointment_date, plan.customer],
    )
    await db.query(
      'insert into staff_daily_availability(staff_user_id,date,is_open) values ($1,$2,false)',
      [tech, plan.appointment_date],
    )
    await db.exec('savepoint rejected')
    await expect(
      save(sid, { calendar_version: rows[0].token }),
    ).rejects.toThrow(/changed/i)
    await db.exec('rollback to savepoint rejected')
    expect(await counts()).toEqual({ jobs: 0, invoices: 0, emails: 0 })
  })
  it('rolls back the whole job and coupon usage when notification handoff fails', async () => {
    await db.exec(
      "insert into promo_codes(code,active,discount_type,discount_amount) values ('FIXTURE',true,'fixed',35);alter table ops_communication_queue add constraint refuse_handoff check (template_key <> 'job_scheduled_email');savepoint rejected",
    )
    await expect(
      save(sid, { coupon_code: 'FIXTURE', discount_applied: 35, total: 195 }),
    ).rejects.toThrow(/refuse_handoff/)
    await db.exec('rollback to savepoint rejected')
    expect(await counts()).toEqual({ jobs: 0, invoices: 0, emails: 0 })
    expect((await db.query('select use_count from promo_codes')).rows).toEqual([
      { use_count: 0 },
    ])
    expect((await db.query('select id from ops_customers')).rows).toEqual([])
  })
  it('saves/replays one zero-quote commercial visit without invoicing or sending residential mail', async () => {
    const token = await version()
    const result = await measure(token)
    expect(result.confirmation_number).toBe(
      'EST-' + result.appointment_id.slice(0, 8).toUpperCase(),
    )
    expect(result).toMatchObject({ created: true })
    expect(await measure(token)).toEqual({ ...result, created: false })
    expect(await counts()).toEqual({ jobs: 1, invoices: 0, emails: 0 })
    expect(
      (
        await db.query(
          'select kind, quoted_total::int as price from ops_appointments',
        )
      ).rows,
    ).toEqual([{ kind: 'estimate', price: 0 }])
    await expect(measure(token, {}, 'd'.repeat(64))).rejects.toThrow(
      /linked to this call/,
    )
  })
  it('requires fresh caller acceptance for a commercial write', async () => {
    const token = await version()
    await db.exec('savepoint rejected')
    await expect(
      measure(token, { expected_caller_sequence: 2 }),
    ).rejects.toThrow(/spoken|caller|changed|turn/i)
    await db.exec('rollback to savepoint rejected')
    expect(await counts()).toEqual({ jobs: 0, invoices: 0, emails: 0 })
  })
  it('rejects a commercial slot after the schedule changes and creates no customer or appointment', async () => {
    const token = await version()
    await db.query(
      "insert into ops_calendar_events(event_kind,start_date,end_date,is_all_day) values('block',$1,$1,true)",
      [measurement.date],
    )
    await db.exec('savepoint rejected')
    await expect(measure(token)).rejects.toThrow(/changed/)
    await db.exec('rollback to savepoint rejected')
    expect(await counts()).toEqual({ jobs: 0, invoices: 0, emails: 0 })
    expect((await db.query('select id from ops_customers')).rows).toEqual([])
  })
})
