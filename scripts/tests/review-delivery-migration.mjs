/**
 * Disposable PostgreSQL/WASM test, never uses project/database credentials.
 * Install @electric-sql/pglite in a temporary directory, then run:
 * node scripts/tests/review-delivery-migration.mjs /tmp/review-db-test
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
if (!process.argv[2])
  throw new Error('Pass the temporary PGlite install directory')
const { PGlite } = await import(
  pathToFileURL(
    resolve(process.argv[2], 'node_modules/@electric-sql/pglite/dist/index.js'),
  ).href
)
const db = new PGlite() // Memory only. No connection URL or filesystem database.
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table review_requests (
    id uuid primary key, status text not null default 'pending',
    sent_at timestamptz, updated_at timestamptz not null default now()
  );
  create table sms_logs (twilio_sid text, message_type text, status text);
  insert into review_requests (id,status) values ('10000000-0000-4000-8000-000000000001','sent');
`)
await db.exec(
  await readFile(
    new URL(
      '../../supabase/migrations/20261110024707_review_request_delivery_tracking.sql',
      import.meta.url,
    ),
    'utf8',
  ),
)
const id = '20000000-0000-4000-8000-000000000001'
const sid = 'SM' + '1'.repeat(32)
const read = async () =>
  (await db.query('select * from review_requests where id=$1', [id])).rows[0]
const record = async (status, callback = true, messageSid = sid, code = null) =>
  (
    await db.query(
      'select record_review_request_delivery($1,$2,$3,$4,$5) as recorded',
      [id, messageSid, status, code, callback],
    )
  ).rows[0].recorded
const reset = async () => {
  await db.query('delete from review_requests where id=$1', [id])
  await db.query(
    'insert into review_requests(id,send_claimed_at) values ($1,now())',
    [id],
  )
  await db.exec('delete from sms_logs')
}
let checks = 0
async function check(name, fn) {
  await fn()
  checks++
  console.log('PASS', name)
}
await check('historical delivery remains unknown', async () => {
  const old = (
    await db.query("select * from review_requests where status='sent'")
  ).rows[0]
  assert.equal(old.delivery_status, 'unknown')
  assert.equal(old.twilio_sid, null)
  assert.equal(old.last_callback_at, null)
})
await check('only service_role may execute the evidence function', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const { rows } = await db.query(
      "select has_function_privilege($1, 'public.record_review_request_delivery(uuid,text,text,text,boolean)', 'EXECUTE') as allowed",
      [role],
    )
    assert.equal(rows[0].allowed, role === 'service_role')
  }
})
await reset()
await check(
  'acceptance is not delivery and does not create callback evidence',
  async () => {
    assert.equal(await record('accepted', false), true)
    const row = await read()
    assert.equal(row.status, 'sent')
    assert.equal(row.delivery_status, 'accepted')
    assert.equal(row.last_callback_at, null)
    assert.equal(row.twilio_sid, sid)
  },
)
await check(
  'signed delivery evidence advances the request and matching review log only',
  async () => {
    await db.query(
      "insert into sms_logs values ($1,'review_request','accepted'),($1,'ordinary_message','sent')",
      [sid],
    )
    await record('delivered')
    assert.equal((await read()).delivery_status, 'delivered')
    assert.ok((await read()).last_callback_at)
    const logs = (
      await db.query('select * from sms_logs order by message_type')
    ).rows
    assert.equal(logs[0].status, 'sent')
    assert.equal(logs[1].status, 'delivered')
  },
)
await check(
  'duplicate and late accepted/sent/failed evidence cannot regress delivered',
  async () => {
    for (const status of ['delivered', 'sent', 'queued', 'failed'])
      await record(status)
    await record('accepted', false)
    assert.equal((await read()).delivery_status, 'delivered')
  },
)
await check('a different SID cannot overwrite correlation', async () => {
  assert.equal(await record('failed', true, 'SM' + '2'.repeat(32)), false)
  assert.equal((await read()).twilio_sid, sid)
  assert.equal((await read()).delivery_status, 'delivered')
})
await reset()
await check(
  'early callback survives later send result and late log insertion',
  async () => {
    await record('delivered')
    await db.query(
      "insert into sms_logs values ($1,'review_request','accepted')",
      [sid],
    )
    await record('accepted', false)
    assert.equal((await read()).delivery_status, 'delivered')
    assert.equal(
      (await db.query('select status from sms_logs')).rows[0].status,
      'delivered',
    )
  },
)
await reset()
await check(
  'undelivered records retain the provider error without resending',
  async () => {
    await record('undelivered', true, sid, '30003')
    await record('queued')
    await record('accepted', false)
    const row = await read()
    assert.equal(row.delivery_status, 'undelivered')
    assert.equal(row.delivery_error_code, '30003')
    assert.equal(row.status, 'sent')
  },
)
await reset()
await check(
  'unclaimed historical rows cannot acquire delivery evidence',
  async () => {
    await db.query(
      'update review_requests set send_claimed_at=null where id=$1',
      [id],
    )
    assert.equal(await record('delivered'), false)
    assert.equal((await read()).delivery_status, 'unknown')
  },
)
await check('claim compare-and-set returns one winner', async () => {
  const query =
    "update review_requests set send_claimed_at=now() where id=$1 and status='pending' and send_claimed_at is null returning id"
  assert.equal((await db.query(query, [id])).rows.length, 1)
  assert.equal((await db.query(query, [id])).rows.length, 0)
})
await reset()
await check(
  'a late verified callback resolves an ambiguous send without retry',
  async () => {
    await db.query("update review_requests set status='failed' where id=$1", [
      id,
    ])
    await record('sent')
    assert.equal((await read()).status, 'sent')
    assert.equal((await read()).delivery_status, 'sent')
  },
)
await reset()
await check(
  'manual suppression is not overwritten by callback bookkeeping',
  async () => {
    await db.query("update review_requests set status='skipped' where id=$1", [
      id,
    ])
    await record('delivered')
    assert.equal((await read()).status, 'skipped')
    assert.equal((await read()).delivery_status, 'delivered')
  },
)
await check('noncallback evidence cannot claim handset delivery', async () => {
  await assert.rejects(
    record('delivered', false),
    /Invalid review SMS evidence/,
  )
  await assert.rejects(record('invented'), /Invalid review SMS evidence/)
})
await db.close()
console.log(
  `${checks} PostgreSQL migration checks passed; no network or customer records used.`,
)
