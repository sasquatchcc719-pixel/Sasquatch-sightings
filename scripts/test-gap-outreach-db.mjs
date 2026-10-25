// Entirely local, in-memory PostgreSQL. Never reads .env or connects to a server.
// npm install --prefix ../gap-test-runtime --ignore-scripts @electric-sql/pglite@0.3.14
import { setupSyntheticGapDatabase } from './gap-outreach-db-fixture.mjs'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PGlite } from '../../gap-test-runtime/node_modules/@electric-sql/pglite/dist/index.js'
const db = new PGlite()
const { owner, staff, customer, address, catalog, date } =
  await setupSyntheticGapDatabase(db)
async function preview(options = {}) {
  const recipient = options.recipient || randomUUID()
  const payload = {
    gap: { date, staff_id: staff, start_time: '10:00', end_time: '13:00' },
    offer: { code: 'TF35', minimum_service_cents: 30000, amount: 35 },
    recipients: [
      {
        id: recipient,
        customer_id: customer,
        phone: '+17195550100',
        body: 'Exact approved test message',
      },
    ],
  }
  const row = (
    await db.query(
      "select preview_gap_outreach($1,$2,$3,$4,now()+interval '10 minutes') x",
      [owner, options.key || randomUUID(), payload, 'hash'],
    )
  ).rows[0].x
  return { id: row.confirmation_id, recipient, payload }
}
async function approve(batch) {
  return (
    await db.query('select approve_gap_outreach($1,$2,$3) x', [
      batch.id,
      owner,
      'hash',
    ])
  ).rows[0].x
}
async function claim(batch) {
  return (
    await db.query('select claim_gap_outreach_recipient($1,$2) x', [
      batch.recipient,
      owner,
    ])
  ).rows[0].x
}
async function status(batch) {
  return (
    await db.query('select status from gap_outreach_recipients where id=$1', [
      batch.recipient,
    ])
  ).rows[0].status
}
let count = 0
async function test(name, fn) {
  await db.exec('begin')
  try {
    await fn()
    console.log('PASS: ' + name)
    count++
  } finally {
    await db.exec('rollback')
  }
}
await test('overlapping approvals and claims allow exactly one sender', async () => {
  const b = await preview()
  assert.deepEqual((await Promise.all([approve(b), approve(b)])).sort(), [
    false,
    true,
  ])
  assert.deepEqual((await Promise.all([claim(b), claim(b)])).sort(), [
    false,
    true,
  ])
})
await test('expired preview releases its phone reservation', async () => {
  const b = await preview()
  await db.query(
    "update gap_outreach_batches set expires_at=now()-interval '1 second' where id=$1",
    [b.id],
  )
  const next = await preview()
  assert.notEqual(next.id, b.id)
  assert.equal(await status(b), 'suppressed')
})
await test('stale approval cannot execute', async () => {
  const b = await preview()
  await db.query(
    "update gap_outreach_batches set expires_at=now()-interval '1 second' where id=$1",
    [b.id],
  )
  assert.equal(await approve(b), false)
})
await test('opt-out after approval suppresses the claim', async () => {
  const b = await preview()
  await approve(b)
  await db.exec("update sms_marketing_consents set status='opted_out'")
  assert.equal(await claim(b), false)
  assert.equal(await status(b), 'suppressed')
})
await test('revoked contact grant stops claims mid-wave', async () => {
  const b = await preview()
  await approve(b)
  await db.exec(
    "update mcp_authorized_users set scopes=array_remove(scopes,'customer:contact')",
  )
  assert.equal(await claim(b), false)
})
await test('owner SMS takeover suppresses pending work', async () => {
  const b = await preview()
  await approve(b)
  await db.exec(
    "insert into sms_logs(recipient_phone,status) values('+17195550100','sent')",
  )
  assert.equal(await status(b), 'suppressed')
  assert.equal(await claim(b), false)
})
await test('email outreach suppresses pending SMS, too', async () => {
  const b = await preview()
  await approve(b)
  await db.query(
    "insert into reactivation_email_log(customer_id,event_type,status) values($1,'email','sent')",
    [customer],
  )
  assert.equal(await status(b), 'suppressed')
})
await test('a concurrent booking fills the gap and suppresses pending work', async () => {
  const b = await preview()
  await approve(b)
  await db.query(
    "insert into ops_appointments(customer_id,service_address_id,assigned_staff_user_id,appointment_date,start_time,end_time) values($1,$2,$3,$4,'10:00','13:00')",
    [customer, address, staff, date],
  )
  assert.equal(await status(b), 'suppressed')
})
await test('duplicate-customer booking on another date suppresses outreach', async () => {
  const b = await preview()
  await approve(b)
  const alias = randomUUID()
  await db.query(
    "insert into ops_customers(id,full_name,phone) values($1,'Alias','7195550100')",
    [alias],
  )
  await db.query(
    "insert into ops_appointments(customer_id,service_address_id,appointment_date,start_time,end_time) values($1,$2,current_date+5,'09:00','11:00')",
    [alias, address],
  )
  assert.equal(await status(b), 'suppressed')
})
await test('uncertain provider result never becomes claimable again', async () => {
  const b = await preview()
  await approve(b)
  await claim(b)
  await db.query('select mark_gap_outreach_uncertain($1,$2)', [b.id, owner])
  assert.equal(await status(b), 'unknown')
  assert.equal(await claim(b), false)
})
await test('signed-provider reconciliation preserves terminal delivered state', async () => {
  const b = await preview()
  await approve(b)
  await claim(b)
  const sid = 'SM' + '1'.repeat(32)
  await db.query('select record_gap_outreach_delivery($1,$2,$3)', [
    b.recipient,
    sid,
    'delivered',
  ])
  await db.query('select record_gap_outreach_delivery($1,$2,$3)', [
    b.recipient,
    sid,
    'sent',
  ])
  assert.equal(await status(b), 'delivered')
})
function plan(amount = 300) {
  return {
    customer: {
      first_name: 'Fixture',
      last_name: 'Customer',
      email: 'fixture@example.test',
      phone: '+17195550100',
    },
    address: {
      street_1: '123 Fixture St',
      city: 'Monument',
      state: 'CO',
      zip_code: '80132',
    },
    appointment_date: date,
    start_time: '10:00',
    end_time: '13:00',
    assigned_staff_user_id: staff,
    appointment_status: 'booked',
    subtotal: amount,
    discount_applied: 35,
    total: amount - 35,
    line_items: [
      {
        service_catalog_item_id: catalog,
        name_snapshot: 'Carpet',
        quantity: 1,
        unit_price: amount,
        line_total: amount,
        duration_minutes: 180,
        pricing_unit: 'fixed',
      },
    ],
    lead_source: { lead_source: 'returning_customer' },
    sync_status: 'held',
  }
}
async function accepted() {
  const b = await preview()
  await approve(b)
  await claim(b)
  await db.query('select finish_gap_outreach_recipient($1,$2,$3,$4)', [
    b.recipient,
    owner,
    'SM' + '2'.repeat(32),
    'accepted',
  ])
  return b
}
await test('$300 quote books and invoices $265 with a single TF35 redemption', async () => {
  const b = await accepted()
  const r = (
    await db.query('select mcp_create_gap_appointment($1,$2,$3,false) x', [
      plan(),
      owner,
      b.recipient,
    ])
  ).rows[0].x
  const inv = (
    await db.query('select * from ops_invoices where id=$1', [r.invoice_id])
  ).rows[0]
  assert.equal(Number(inv.discount_amount), 35)
  assert.equal(Number(inv.total), 265)
  assert.equal(inv.discount_metadata.promo.code, 'TF35')
  await assert.rejects(() =>
    db.query('select mcp_create_gap_appointment($1,$2,$3,false)', [
      plan(),
      owner,
      b.recipient,
    ]),
  )
})
await test('fees never qualify $299.99 and failed redemption creates no appointment', async () => {
  const b = await accepted()
  const p = plan(299.99)
  p.subtotal = 350
  p.total = 315
  p.line_items.push({
    service_catalog_item_id: null,
    name_snapshot: 'Mileage/ Travel',
    quantity: 1,
    unit_price: 50.01,
    line_total: 50.01,
    duration_minutes: 0,
    pricing_unit: 'fixed',
  })
  await db.exec('savepoint rejected_offer')
  await assert.rejects(() =>
    db.query('select mcp_create_gap_appointment($1,$2,$3,false)', [
      p,
      owner,
      b.recipient,
    ]),
  )
  await db.exec('rollback to rejected_offer')
  assert.equal(
    (await db.query('select count(*) n from ops_appointments')).rows[0].n,
    0,
  )
})

await test('estimate conversion atomically preserves TF35 totals and metadata', async () => {
  const b = await accepted(),
    estimate = randomUUID()
  await db.query(
    "insert into ops_appointments(id,customer_id,service_address_id,appointment_date,start_time,end_time,kind,status,estimate_status,quoted_total) values($1,$2,$3,current_date-1,'09:00','11:00','estimate','completed','accepted',300)",
    [estimate, customer, address],
  )
  await db.query(
    "insert into ops_appointment_line_items(appointment_id,service_catalog_item_id,name_snapshot,quantity,unit_price,line_total,duration_minutes,pricing_unit_snapshot) values($1,$2,'Carpet',1,300,300,120,'fixed')",
    [estimate, catalog],
  )
  const version = (
    await db.query('select updated_at from ops_appointments where id=$1', [
      estimate,
    ])
  ).rows[0].updated_at
  const result = (
    await db.query(
      "select mcp_convert_gap_estimate($1,$2,'accepted',$3,'10:00','12:00',$4,35,$5,'held',false,$6,false) x",
      [estimate, version, date, staff, owner, b.recipient],
    )
  ).rows[0].x
  const inv = (
    await db.query(
      'select total,discount_amount,discount_metadata from ops_invoices where id=$1',
      [result.invoice_id],
    )
  ).rows[0]
  assert.equal(Number(inv.total), 265)
  assert.equal(Number(inv.discount_amount), 35)
  assert.equal(inv.discount_metadata.promo.code, 'TF35')
})

await test('a $400 job cannot be squeezed into a one-hour gap booking', async () => {
  const b = await accepted(),
    p = plan(400)
  p.end_time = '11:00'
  await assert.rejects(
    () =>
      db.query('select mcp_create_gap_appointment($1,$2,$3,false)', [
        p,
        owner,
        b.recipient,
      ]),
    /Complete job duration/,
  )
})
console.log(
  `Passed ${count} local PostgreSQL scenarios. PGlite has one connection; run test-gap-outreach-postgres.mjs separately for multi-session lock contention.`,
)
await db.close()
