// Local PostgreSQL fixture only; no network, account credentials or real records.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
const { PGlite } = await import(
  process.env.PGLITE_MODULE || '@electric-sql/pglite'
)
const db = new PGlite()
try {
  await db.exec(
    'create role anon; create role authenticated; create role service_role bypassrls;',
  )
  const dir = new URL('../supabase/migrations/', import.meta.url)
  const migration = (await readdir(dir)).find((name) =>
    name.endsWith('_limit_location_partner_pin_attempts.sql'),
  )
  await db.exec(await readFile(new URL(migration, dir), 'utf8'))
  const id = '10000000-0000-4000-8000-000000000001'
  async function consume(partner = id) {
    await db.exec('set role service_role')
    try {
      return (
        await db.query(
          'select public.consume_location_partner_pin_attempt($1) allowed',
          [partner],
        )
      ).rows[0].allowed
    } finally {
      await db.exec('reset role')
    }
  }
  for (let n = 0; n < 5; n++) assert.equal(await consume(), true)
  assert.equal(await consume(), false)
  assert.equal(await consume(), false)
  assert.equal(await consume('10000000-0000-4000-8000-000000000002'), true)
  assert.equal(
    (
      await db.query(
        'select attempts from public.location_partner_pin_attempts where partner_id=$1',
        [id],
      )
    ).rows[0].attempts,
    5,
  )
  await db.query(
    "update public.location_partner_pin_attempts set window_started_at=clock_timestamp()-interval '16 minutes' where partner_id=$1",
    [id],
  )
  assert.equal(await consume(), true)
  assert.equal(
    (
      await db.query(
        'select attempts from public.location_partner_pin_attempts where partner_id=$1',
        [id],
      )
    ).rows[0].attempts,
    1,
  )
  const grants = (
    await db.query(
      `select has_function_privilege('anon','public.consume_location_partner_pin_attempt(uuid)','execute') a,has_function_privilege('authenticated','public.consume_location_partner_pin_attempt(uuid)','execute') b,has_table_privilege('anon','public.location_partner_pin_attempts','select') c,has_table_privilege('authenticated','public.location_partner_pin_attempts','update') d`,
    )
  ).rows[0]
  assert.deepEqual(grants, { a: false, b: false, c: false, d: false })
  await db.query(
    "update public.location_partner_pin_attempts set window_started_at=clock_timestamp()-interval '2 days'",
  )
  await consume()
  assert.equal(
    (
      await db.query(
        'select count(*)::int n from public.location_partner_pin_attempts',
      )
    ).rows[0].n,
    1,
  )
  console.log(
    'Location partner PIN account attempt budget fixture passed; no network or live records.',
  )
} finally {
  await db.close()
}
