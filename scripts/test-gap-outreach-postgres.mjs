// Real independent PostgreSQL sessions in an ephemeral localhost-only container.
// Uses only the installed official postgres:17-alpine image; no .env, mounts or production URL.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { setupSyntheticGapDatabase } from './gap-outreach-db-fixture.mjs'
const name = `sightings-gap-fixture-${randomUUID()}`
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
let pool
let container
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
try {
  container = docker([
    'run',
    '--rm',
    '--detach',
    '--pull=never',
    '--name',
    name,
    '--label',
    'com.sasquatch.fixture=gap-management',
    '--publish',
    '127.0.0.1::5432',
    '--env',
    'POSTGRES_PASSWORD=synthetic-fixture-only',
    'postgres:17-alpine',
  ])
  const inspected = JSON.parse(docker(['inspect', container]))[0]
  const binding = inspected.NetworkSettings.Ports['5432/tcp'][0]
  assert.equal(binding.HostIp, '127.0.0.1')
  pool = new pg.Pool({
    host: '127.0.0.1',
    port: Number(binding.HostPort),
    user: 'postgres',
    password: 'synthetic-fixture-only',
    database: 'postgres',
    max: 5,
    connectionTimeoutMillis: 1000,
    options: '-c statement_timeout=8000 -c lock_timeout=5000',
  })
  let ready = false
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await pool.query('select 1')
      ready = true
      break
    } catch {
      await sleep(250)
    }
  }
  assert.ok(ready, 'Synthetic PostgreSQL did not become ready')
  console.log(
    `Local PostgreSQL ${(await pool.query('show server_version')).rows[0].server_version}; container ${name}`,
  )
  const { owner, staff, customer, address, catalog, date } =
    await setupSyntheticGapDatabase({
      query: (...args) => pool.query(...args),
      exec: (sql) => pool.query(sql),
    })
  async function reset() {
    await pool.query(
      'truncate ops_sms_consent_events,drip_email_log,drip_campaign_enrollments,gap_outreach_contacts,gap_outreach_recipients,gap_outreach_batches,ops_invoice_line_items,ops_invoices,ops_appointment_line_items,ops_appointment_status_events,ops_invoice_status_events,ops_appointments restart identity cascade',
    )
    await pool.query(
      "update sms_marketing_consents set status='opted_in'; update mcp_authorized_users set scopes=array['business:read','outreach:write','customer:contact','business:write','finance:write','estimates:write']",
    )
  }
  async function preview(client = pool) {
    const recipient = randomUUID(),
      payload = {
        gap: { date, staff_id: staff, start_time: '10:00', end_time: '13:00' },
        offer: { code: 'TF35', minimum_service_cents: 30000, amount: 35 },
        recipients: [
          {
            id: recipient,
            customer_id: customer,
            phone: '+17195550100',
            body: 'Synthetic message; no sender is called',
          },
        ],
      }
    const result = await client.query(
      "select preview_gap_outreach($1,$2,$3,'hash',now()+interval '10 minutes') x",
      [owner, randomUUID(), payload],
    )
    return { id: result.rows[0].x.confirmation_id, recipient }
  }
  const approve = (b, c = pool) =>
    c.query("select approve_gap_outreach($1,$2,'hash') x", [b.id, owner])
  const claim = (b, c = pool) =>
    c.query('select claim_gap_outreach_recipient($1,$2) x', [
      b.recipient,
      owner,
    ])
  const booking = (c = pool) =>
    c.query(
      "insert into ops_appointments(customer_id,service_address_id,assigned_staff_user_id,appointment_date,start_time,end_time) values($1,$2,$3,$4,'10:00','13:00')",
      [customer, address, staff, date],
    )
  async function waitForLock(pid) {
    for (let i = 0; i < 40; i++) {
      const row = (
        await pool.query(
          'select wait_event_type from pg_stat_activity where pid=$1',
          [pid],
        )
      ).rows[0]
      if (row?.wait_event_type === 'Lock') return
      await sleep(25)
    }
    throw new Error('Second session never reached expected row-lock wait')
  }
  let count = 0
  async function test(label, fn) {
    await reset()
    await fn()
    count++
    console.log('PASS: ' + label)
  }
  await test('independent concurrent approvals and recipient claims permit one executor', async () => {
    const b = await preview(),
      a = await pool.connect(),
      c = await pool.connect()
    try {
      assert.deepEqual(
        (await Promise.all([approve(b, a), approve(b, c)]))
          .map((r) => r.rows[0].x)
          .sort(),
        [false, true],
      )
      assert.deepEqual(
        (await Promise.all([claim(b, a), claim(b, c)]))
          .map((r) => r.rows[0].x)
          .sort(),
        [false, true],
      )
    } finally {
      a.release()
      c.release()
    }
  })
  await test('concurrent distinct previews cannot reserve one phone twice', async () => {
    const a = await pool.connect(),
      b = await pool.connect()
    try {
      const results = await Promise.allSettled([preview(a), preview(b)])
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
      assert.equal(
        (await pool.query('select count(*)::int n from gap_outreach_batches'))
          .rows[0].n,
        1,
      )
    } finally {
      a.release()
      b.release()
    }
  })
  await test('a booking held uncommitted blocks then suppresses a send claim', async () => {
    const b = await preview()
    await approve(b)
    const a = await pool.connect(),
      c = await pool.connect()
    try {
      await a.query('begin')
      await booking(a)
      const pid = (await c.query('select pg_backend_pid() pid')).rows[0].pid
      const blocked = claim(b, c)
      await waitForLock(pid)
      await a.query('commit')
      assert.equal((await blocked).rows[0].x, false)
    } finally {
      await a.query('rollback')
      a.release()
      c.release()
    }
  })
  await test('a previously claimed send fails preflight after a competing booking commits', async () => {
    const b = await preview()
    await approve(b)
    const a = await pool.connect(),
      c = await pool.connect()
    try {
      await a.query('begin')
      assert.equal((await claim(b, a)).rows[0].x, true)
      const pid = (await c.query('select pg_backend_pid() pid')).rows[0].pid
      const blocked = booking(c)
      await waitForLock(pid)
      await a.query('commit')
      await blocked
      assert.equal(
        (
          await pool.query('select check_gap_outreach_send($1,$2) x', [
            b.recipient,
            owner,
          ])
        ).rows[0].x,
        false,
      )
    } finally {
      await a.query('rollback')
      a.release()
      c.release()
    }
  })
  await test('owner contact committing after a claim suppresses its provider preflight', async () => {
    const b = await preview()
    await approve(b)
    const a = await pool.connect(),
      c = await pool.connect()
    try {
      await a.query('begin')
      await claim(b, a)
      const pid = (await c.query('select pg_backend_pid() pid')).rows[0].pid
      const blocked = c.query(
        "insert into sms_logs(recipient_phone,status) values('+17195550100','sent')",
      )
      await waitForLock(pid)
      await a.query('commit')
      await blocked
      assert.equal(
        (
          await pool.query('select check_gap_outreach_send($1,$2) x', [
            b.recipient,
            owner,
          ])
        ).rows[0].x,
        false,
      )
    } finally {
      await a.query('rollback')
      a.release()
      c.release()
    }
  })
  await test('drip email committing after a claim suppresses final provider preflight', async () => {
    const b = await preview()
    await approve(b)
    const enrollment = (
      await pool.query(
        'insert into drip_campaign_enrollments(customer_id) values($1) returning id',
        [customer],
      )
    ).rows[0].id
    const a = await pool.connect(),
      c = await pool.connect()
    try {
      await a.query('begin')
      assert.equal((await claim(b, a)).rows[0].x, true)
      const pid = (await c.query('select pg_backend_pid() pid')).rows[0].pid
      const blocked = c.query(
        "insert into drip_email_log(enrollment_id,status) values($1,'sent')",
        [enrollment],
      )
      await waitForLock(pid)
      await a.query('commit')
      await blocked
      assert.equal(
        (
          await pool.query('select check_gap_outreach_send($1,$2) x', [
            b.recipient,
            owner,
          ])
        ).rows[0].x,
        false,
      )
    } finally {
      await a.query('rollback')
      a.release()
      c.release()
    }
  })
  await test('concurrent booking redemptions create exactly one $265 invoice', async () => {
    const b = await preview()
    await approve(b)
    await claim(b)
    await pool.query(
      "select finish_gap_outreach_recipient($1,$2,$3,'accepted')",
      [b.recipient, owner, 'SM' + '1'.repeat(32)],
    )
    const plan = {
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
      end_time: '12:00',
      assigned_staff_user_id: staff,
      appointment_status: 'booked',
      subtotal: 300,
      discount_applied: 35,
      total: 265,
      line_items: [
        {
          service_catalog_item_id: catalog,
          name_snapshot: 'Carpet',
          quantity: 1,
          unit_price: 300,
          line_total: 300,
          duration_minutes: 120,
          pricing_unit: 'fixed',
        },
      ],
      lead_source: { lead_source: 'returning_customer' },
      sync_status: 'held',
    }
    const a = await pool.connect(),
      c = await pool.connect()
    try {
      const results = await Promise.allSettled([
        a.query('select mcp_create_gap_appointment($1,$2,$3,false)', [
          plan,
          owner,
          b.recipient,
        ]),
        c.query('select mcp_create_gap_appointment($1,$2,$3,false)', [
          plan,
          owner,
          b.recipient,
        ]),
      ])
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
      const invoices = (await pool.query('select total from ops_invoices')).rows
      assert.equal(invoices.length, 1)
      assert.equal(Number(invoices[0].total), 265)
    } finally {
      a.release()
      c.release()
    }
  })
  await test('stale approval update held by another session wins before approval', async () => {
    const b = await preview(),
      a = await pool.connect(),
      c = await pool.connect()
    try {
      await a.query('begin')
      await a.query(
        "update gap_outreach_batches set expires_at=now()-interval '1 second' where id=$1",
        [b.id],
      )
      const pid = (await c.query('select pg_backend_pid() pid')).rows[0].pid
      const blocked = approve(b, c)
      await waitForLock(pid)
      await a.query('commit')
      assert.equal((await blocked).rows[0].x, false)
    } finally {
      await a.query('rollback')
      a.release()
      c.release()
    }
  })
  console.log(
    `Passed ${count} true multi-session PostgreSQL contention scenarios; no provider sender or production connection exists in this runner.`,
  )
} finally {
  if (pool) await pool.end()
  if (container) {
    docker(['rm', '--force', container])
    console.log(`Removed only test container ${name}`)
  }
}
