// Runs entirely in local PostgreSQL with fake appointments and an inert HTTP stub.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite')
const db = new PGlite()
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema vault; create schema net;
    create table vault.decrypted_secrets(name text, decrypted_secret text);
    create table public.ops_appointments(id uuid, source text, kind text);
    create table net.requests(url text, body jsonb, headers jsonb);
    create function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer)
    returns bigint language plpgsql as $$ begin
      insert into net.requests values(url,body,headers); return 1;
    end $$;
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/20261028220855_authenticate_booking_notifications.sql', import.meta.url), 'utf8'))
  await db.exec('create trigger booked after insert on public.ops_appointments for each row execute function public.notify_appointment_booked()')
  const id = '10000000-0000-4000-8000-000000000001'
  const insert = (source = 'fixture', kind = 'cleaning') => db.query('insert into public.ops_appointments values($1,$2,$3)', [id,source,kind])
  await insert()
  assert.equal((await db.query('select count(*)::int n from net.requests')).rows[0].n,0, 'missing credential suppresses notification without blocking booking')
  await db.exec("insert into vault.decrypted_secrets values('sightings_appointment_webhook_secret','local-fixture-only')")
  await insert('integration_test')
  await insert('fixture','estimate')
  assert.equal((await db.query('select count(*)::int n from net.requests')).rows[0].n,0, 'fixtures and estimates do not notify')
  await db.exec("set app.settings.webhook_url='https://untrusted.invalid/collect'")
  await insert()
  const request = (await db.query('select * from net.requests')).rows[0]
  assert.equal(request.url,'https://sightings.sasquatchcarpet.com/api/webhooks/appointment-booked')
  assert.equal(request.headers['x-webhook-secret'],'local-fixture-only')
  assert.deepEqual(request.body,{ type:'INSERT', record:{id} })
  const grants = (await db.query("select has_function_privilege('anon','public.notify_appointment_booked()','execute') anon,has_function_privilege('authenticated','public.notify_appointment_booked()','execute') authenticated")).rows[0]
  assert.deepEqual(grants,{anon:false,authenticated:false})
  await db.exec('drop function net.http_post(text,jsonb,jsonb,jsonb,integer)')
  await insert()
  assert.equal((await db.query('select count(*)::int n from public.ops_appointments')).rows[0].n,5, 'notification failure never blocks booking')
  console.log('Booking notification authentication fixture passed; no network calls or live records.')
} finally {
  await db.close()
}
