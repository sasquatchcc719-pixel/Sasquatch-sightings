// Isolated in-memory SQL fixtures. No .env, network or production credentials.
// Usage: node scripts/test-unscheduled-follow-up-db.mjs /absolute/path/to/pglite/dist/index.js
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const { PGlite } = await import(pathToFileURL(process.argv[2]).href)
const db = new PGlite()
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.ops_appointments(id uuid primary key,parked_at timestamptz,internal_notes text);
    insert into ops_appointments values('10000000-0000-4000-8000-000000000001','2026-10-01T12:00:00Z',null),
      ('10000000-0000-4000-8000-000000000002',null,null);`)
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261026180133_add_unscheduled_follow_up_dates.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  const rows = await db.query(`select * from ops_unscheduled_follow_ups`)
  assert.equal(rows.rows.length, 1)
  const today = (
    await db.query(`select (now() at time zone 'America/Denver')::date::text d`)
  ).rows[0].d
  assert.equal(
    rows.rows[0].next_follow_up_date.toISOString().slice(0, 10),
    today,
  )
  console.log(
    'PASS: backfill includes parked jobs only and schedules overdue work for review',
  )
  await db.exec(
    `insert into ops_appointments values('10000000-0000-4000-8000-000000000003','2026-11-01T05:30:00Z',null)`,
  )
  let row = (
    await db.query(
      `select * from ops_unscheduled_follow_ups where appointment_id='10000000-0000-4000-8000-000000000003'`,
    )
  ).rows[0]
  assert.equal(row.next_follow_up_date.toISOString().slice(0, 10), '2026-11-03') // Denver Oct31, not UTC Nov1.
  console.log('PASS: new parking uses Denver calendar days across DST')
  await db.exec(`update ops_unscheduled_follow_ups set next_follow_up_date='2027-02-01',review_note='Reviewed' where appointment_id='10000000-0000-4000-8000-000000000003';
    update ops_appointments set internal_notes='Unrelated' where id='10000000-0000-4000-8000-000000000003'`)
  row = (
    await db.query(
      `select * from ops_unscheduled_follow_ups where appointment_id='10000000-0000-4000-8000-000000000003'`,
    )
  ).rows[0]
  assert.equal(row.next_follow_up_date.toISOString().slice(0, 10), '2027-02-01')
  console.log(
    'PASS: unrelated appointment edits preserve staff follow-up dates',
  )
  await db.exec(
    `update ops_appointments set parked_at=null where id='10000000-0000-4000-8000-000000000003'`,
  )
  row = (
    await db.query(
      `select * from ops_unscheduled_follow_ups where appointment_id='10000000-0000-4000-8000-000000000003'`,
    )
  ).rows[0]
  assert.ok(row.resolved_at)
  console.log(
    'PASS: rescheduling resolves follow-up without deleting its review',
  )
  await db.exec(
    `update ops_appointments set parked_at='2027-03-10T18:00:00Z' where id='10000000-0000-4000-8000-000000000003'`,
  )
  row = (
    await db.query(
      `select * from ops_unscheduled_follow_ups where appointment_id='10000000-0000-4000-8000-000000000003'`,
    )
  ).rows[0]
  assert.equal(row.next_follow_up_date.toISOString().slice(0, 10), '2027-03-13')
  assert.equal(row.resolved_at, null)
  assert.equal(row.review_note, null)
  console.log('PASS: re-parking begins a new follow-up cycle')
  const access = (
    await db.query(`select has_table_privilege('anon','ops_unscheduled_follow_ups','select') a,
    has_table_privilege('authenticated','ops_unscheduled_follow_ups','update') b,
    has_table_privilege('service_role','ops_unscheduled_follow_ups','update') c,
    has_function_privilege('authenticated','sync_unscheduled_follow_up()','execute') d`)
  ).rows[0]
  assert.deepEqual(access, { a: false, b: false, c: true, d: false })
  console.log(
    'PASS: table and trigger function are private to server operations',
  )
} finally {
  await db.close()
}
