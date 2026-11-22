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
    'verified_phone_booking_contacts',
    'bind_saved_phone_measurement',
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

describe('residential booking for verified shared-phone profiles', () => {
  const selectedId = '84000000-0000-4000-8000-000000000002'
  const siblingId = '84000000-0000-4000-8000-000000000001'
  const selectedSite = '85000000-0000-4000-8000-000000000002'
  const siblingSite = '85000000-0000-4000-8000-000000000001'
  const verified = {
    verified_customer_id: selectedId,
    verified_service_address_id: selectedSite,
    use_saved_email: true,
    address: { ...address, street_2: 'Apt 2' },
  }
  // Canonical selection belongs to caller verification. Deliberately make its chosen
  // record different from the first UUID or most recently updated record.
  beforeEach(async () => {
    await db.query(
      `insert into ops_customers(id,first_name,last_name,full_name,phone,email,updated_at)
      values ($1,'Fixture','Caller','Fixture Caller','(202) 555-0101',$3,now()-interval '1 day'),
             ($2,'Fixture','Caller','Fixture Caller',$4,$3,now())`,
      [selectedId, siblingId, contact.email, contact.phone],
    )
    await db.query(
      `insert into ops_service_addresses(id,customer_id,street_1,street_2,city,state,zip_code)
      values ($1,$2,'1 Sample Street','Unit 2','Monument','CO','80132'),
             ($3,$4,'1 Sample St','Apt 2','Monument','CO','80132')`,
      [selectedSite, selectedId, siblingSite, siblingId],
    )
  })
  async function profiles() {
    return {
      customers: (await db.query('select * from ops_customers order by id'))
        .rows,
      addresses: (
        await db.query('select * from ops_service_addresses order by id')
      ).rows,
    }
  }
  it('saves on the verified pair, preserves both profiles, queues one email and replays on the same job', async () => {
    const before = await profiles()
    const booked = await save(sid, verified)
    expect(booked).toMatchObject({
      customer_id: selectedId,
      address_id: selectedSite,
    })
    expect(await save(sid, verified)).toMatchObject({
      appointment_id: booked.appointment_id,
      replayed: true,
    })
    expect(await profiles()).toEqual(before)
    expect(
      (
        await db.query(
          'select customer_id,service_address_id from ops_appointments',
        )
      ).rows,
    ).toEqual([{ customer_id: selectedId, service_address_id: selectedSite }])
    expect(
      (
        await db.query(
          'select customer_id,payload from ops_communication_queue',
        )
      ).rows[0],
    ).toMatchObject({ customer_id: selectedId, payload: { to: contact.email } })
    expect(await counts()).toEqual({ jobs: 1, invoices: 1, emails: 1 })
  })
  it('replaces a legacy placeholder only after spelling a new email for that verified profile', async () => {
    await db.query('update ops_customers set email=$1 where id=$2', [
      'legacy@import.local',
      selectedId,
    ])
    await db.query('update ops_customers set email=$1 where id=$2', [
      'sibling@example.test',
      siblingId,
    ])
    await db.exec('savepoint refused')
    await expect(save(sid, verified)).rejects.toThrow(/Saved email/)
    await db.exec('rollback to savepoint refused')
    await save(sid, { ...verified, use_saved_email: false })
    expect(
      (await db.query('select email from ops_customers order by id')).rows,
    ).toEqual([{ email: 'sibling@example.test' }, { email: contact.email }])
  })
  it('requires a spoken email to disambiguate two valid recipients at the same location', async () => {
    await db.query('update ops_customers set email=$1 where id=$2', [
      'other@example.test',
      siblingId,
    ])
    const before = await profiles()
    await db.exec('savepoint refused')
    await expect(save(sid, verified)).rejects.toThrow(/Saved email/)
    await db.exec('rollback to savepoint refused')
    expect(await counts()).toEqual({ jobs: 0, invoices: 0, emails: 0 })
    expect(
      await save(sid, { ...verified, use_saved_email: false }),
    ).toMatchObject({ customer_id: selectedId, address_id: selectedSite })
    expect(await profiles()).toEqual(before)
  })
  it.each([
    { verified_service_address_id: siblingSite },
    { verified_customer_id: null },
    { address: { ...address, street_2: 'Unit 9' } },
    { customer: { ...contact, last_name: 'Other' } },
    { customer: { ...contact, email: 'unconfirmed@example.test' } },
    { customer: { ...contact, phone: '+12025550199' } },
  ])(
    'refuses mismatched proof without editing either contact or sending an email',
    async (change) => {
      const before = await profiles()
      await db.exec('savepoint refused')
      await expect(save(sid, { ...verified, ...change })).rejects.toThrow()
      await db.exec('rollback to savepoint refused')
      expect(await profiles()).toEqual(before)
      expect(await counts()).toEqual({ jobs: 0, invoices: 0, emails: 0 })
    },
  )
  it('checks existing jobs on equivalent profiles and leaves ambiguous unverified callers unbooked', async () => {
    await db.exec('savepoint refused')
    await expect(save()).rejects.toThrow(/office review/)
    await db.exec('rollback to savepoint refused')
    await db.query(
      `insert into ops_appointments(customer_id,service_address_id,appointment_date,start_time,end_time)
        values ($1,$2,$3,'15:00','16:00')`,
      [siblingId, siblingSite, plan.appointment_date],
    )
    await expect(save(sid, verified)).rejects.toThrow(/overlapping appointment/)
  })
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

describe('returning commercial measuring contacts', () => {
  async function site(
    email = contact.email,
    company: string | null = 'Fixture Offices',
    street = address.street_1,
  ) {
    const {
      rows: [record],
    } = await db.query<{ id: string }>(
      'insert into ops_customers(first_name,last_name,full_name,business_name,phone,email) values ($1,$2,$3,$4,$5,$6) returning id',
      [
        contact.first_name,
        contact.last_name,
        'Fixture Caller',
        company,
        contact.phone,
        email,
      ],
    )
    const {
      rows: [location],
    } = await db.query<{ id: string }>(
      'insert into ops_service_addresses(customer_id,street_1,street_2,city,state,zip_code) values($1,$2,$3,$4,$5,$6) returning id',
      [
        record.id,
        street,
        'Suite 6',
        address.city,
        address.state,
        address.zip_code,
      ],
    )
    return {
      customer_id: record.id,
      address_id: location.id,
      use_saved_email: true,
    }
  }
  const supplied = {
    ...address,
    street_1: '1 Sample Street',
    street_2: 'unit 6',
  }
  it('binds the selected pair, replays without side effects and detects a pending visit on the equivalent duplicate', async () => {
    const first = await site()
    const duplicate = await site(
      contact.email.toUpperCase(),
      'Fixture Offices',
      '1 Sample Street',
    )
    const args = { address: supplied, saved_contact: first }
    const stamp = await version()
    const receipt = await measure(stamp, args)
    expect(await measure(stamp, args)).toMatchObject({
      ...receipt,
      created: false,
    })
    const { rows } = await db.query(
      'select customer_id,service_address_id from ops_appointments',
    )
    expect(rows).toEqual([
      { customer_id: first.customer_id, service_address_id: first.address_id },
    ])
    await db.exec('savepoint another')
    await expect(
      db.query('select create_phone_measurement($1,$2,$3,$4)', [
        secondSid,
        'd'.repeat(64),
        { ...measurement, address: supplied, saved_contact: duplicate },
        await version(),
      ]),
    ).rejects.toThrow(/already scheduled/)
    await db.exec('rollback to savepoint another')
    expect(await counts()).toEqual({ jobs: 1, invoices: 0, emails: 0 })
  })
  it('rejects a business or unit mismatch, a foreign address, and a personal contact on the same inbound line', async () => {
    const selected = await site()
    const personal = await site(contact.email, null)
    const stamp = await version()
    for (const changes of [
      { saved_contact: personal, address: supplied },
      {
        saved_contact: selected,
        address: supplied,
        expected_caller_sequence: null,
      },
      {
        saved_contact: selected,
        address: supplied,
        customer: { ...measurement.customer, business_name: 'Another Company' },
      },
      {
        saved_contact: selected,
        address: { ...supplied, street_2: 'Suite 10' },
      },
      {
        saved_contact: { ...selected, address_id: personal.address_id },
        address: supplied,
      },
    ]) {
      await db.exec('savepoint denied')
      await expect(measure(stamp, changes)).rejects.toThrow()
      await db.exec('rollback to savepoint denied')
    }
    expect(await counts()).toEqual({ jobs: 0, invoices: 0, emails: 0 })
  })
  it('requires a caller-supplied email when otherwise identical commercial profiles disagree', async () => {
    const selected = await site()
    await site('office2@example.test')
    const stamp = await version()
    await db.exec('savepoint denied')
    await expect(
      measure(stamp, { address: supplied, saved_contact: selected }),
    ).rejects.toThrow(/spell and confirm/)
    await db.exec('rollback to savepoint denied')
    const receipt = await measure(stamp, {
      address: supplied,
      saved_contact: { ...selected, use_saved_email: false },
    })
    expect(receipt.confirmation_number).toMatch(/^EST-/)
    expect(await counts()).toEqual({ jobs: 1, invoices: 0, emails: 0 })
  })
})
