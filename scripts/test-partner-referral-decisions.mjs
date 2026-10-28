// Isolated local PostgreSQL only: fake schema, roles and records; no credentials.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
const { PGlite } = await import(
  process.env.PGLITE_MODULE || '@electric-sql/pglite'
)
const db = new PGlite()
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.partners(id uuid primary key,user_id uuid unique,referral_balance_owed numeric default 0);
    create table public.outbound_referrals(id uuid primary key,partner_id uuid references public.partners(id),client_name text,client_phone text,client_email text,notes text,referral_fee numeric,status text default 'pending',accepted_at timestamptz,viewed_at timestamptz);
    alter table public.partners enable row level security;
    alter table public.outbound_referrals enable row level security;
    grant select,update on public.partners,public.outbound_referrals to service_role;
  `)
  const directory = new URL('../supabase/migrations/', import.meta.url)
  const migration = (await readdir(directory)).find((name) =>
    name.endsWith('_secure_partner_referral_acceptance.sql'),
  )
  assert.ok(migration, 'review migration exists')
  await db.exec(await readFile(new URL(migration, directory), 'utf8'))
  const partner = '10000000-0000-4000-8000-000000000001'
  const user = '10000000-0000-4000-8000-000000000002'
  const other = '10000000-0000-4000-8000-000000000003'
  const ids = Array.from(
    { length: 6 },
    (_, index) => `20000000-0000-4000-8000-00000000000${index}`,
  )
  await db.query('insert into public.partners values($1,$2,10),($3,$3,0)', [
    partner,
    user,
    other,
  ])
  for (let index = 0; index < ids.length; index++) {
    await db.query(
      `insert into public.outbound_referrals(id,partner_id,client_name,client_phone,referral_fee) values($1,$2,'Fixture Client','7195550100',$3)`,
      [ids[index], partner, index === 4 ? -1 : index === 5 ? 0 : 25],
    )
  }
  const decide = async (id, action, actor = user) => {
    await db.exec('set role service_role')
    try {
      return (
        await db.query(
          'select public.review_partner_outbound_referral($1,$2,$3) receipt',
          [actor, id, action],
        )
      ).rows[0].receipt
    } finally {
      await db.exec('reset role')
    }
  }
  const state = async (id) =>
    (
      await db.query(
        'select status,accepted_at,viewed_at from public.outbound_referrals where id=$1',
        [id],
      )
    ).rows[0]
  const balance = async () =>
    Number(
      (
        await db.query(
          'select referral_balance_owed from public.partners where id=$1',
          [partner],
        )
      ).rows[0].referral_balance_owed,
    )
  assert.equal((await decide(ids[0], 'accept')).success, true)
  const accepted = await state(ids[0])
  assert.equal(await balance(), 35)
  assert.equal((await decide(ids[0], 'accept')).replayed, true)
  assert.equal(await balance(), 35)
  assert.deepEqual(await state(ids[0]), accepted)
  assert.equal((await decide(ids[0], 'decline')).code, 'DECISION_CONFLICT')
  await db.query(
    "update public.outbound_referrals set status='completed' where id=$1",
    [ids[0]],
  )
  assert.equal((await decide(ids[0], 'accept')).status, 'completed')
  assert.equal(
    await balance(),
    35,
    'completed acceptance replay does not recharge',
  )
  assert.equal((await decide(ids[1], 'decline')).status, 'declined')
  const declined = await state(ids[1])
  assert.equal((await decide(ids[1], 'decline')).replayed, true)
  assert.deepEqual(await state(ids[1]), declined)
  assert.equal((await decide(ids[1], 'accept')).code, 'DECISION_CONFLICT')
  assert.equal(await balance(), 35)
  assert.equal(
    (await decide(ids[2], 'accept', other)).code,
    'REFERRAL_NOT_FOUND',
  )
  assert.equal(
    (await decide(ids[2], 'accept', '30000000-0000-4000-8000-000000000000'))
      .code,
    'PARTNER_NOT_FOUND',
  )
  assert.equal((await state(ids[2])).status, 'pending')
  assert.equal((await decide(ids[2], 'accept')).success, true)
  assert.equal(
    await balance(),
    60,
    'distinct referral fees accumulate without overwriting',
  )
  await db.exec(
    `create function public.fail_fixture_balance() returns trigger language plpgsql as $$begin raise exception 'forced balance failure';end;$$;create trigger fail_fixture_balance before update on public.partners for each row execute function public.fail_fixture_balance();`,
  )
  await assert.rejects(decide(ids[3], 'accept'), /forced balance failure/)
  assert.deepEqual(await state(ids[3]), {
    status: 'pending',
    accepted_at: null,
    viewed_at: null,
  })
  assert.equal(
    await balance(),
    60,
    'failed fee update rolls back the accepted decision too',
  )
  await db.exec('drop trigger fail_fixture_balance on public.partners')
  assert.equal((await decide(ids[3], 'accept')).replayed, false)
  assert.equal(await balance(), 85)
  await assert.rejects(decide(ids[4], 'accept'), /Invalid saved referral fee/)
  assert.equal((await state(ids[4])).status, 'pending')
  assert.equal((await decide(ids[5], 'accept')).status, 'accepted')
  assert.equal(await balance(), 85, 'zero fee creates no balance change')
  assert.equal((await decide(ids[0], 'invalid')).code, 'INVALID_DECISION')
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    try {
      await assert.rejects(
        db.query('select public.review_partner_outbound_referral($1,$2,$3)', [
          user,
          ids[0],
          'accept',
        ]),
        /permission denied for function/,
      )
    } finally {
      await db.exec('reset role')
    }
  }
  const privileges = (
    await db.query(
      `select has_function_privilege('service_role','public.review_partner_outbound_referral(uuid,uuid,text)','execute') service,prosecdef from pg_proc where oid='public.review_partner_outbound_referral(uuid,uuid,text)'::regprocedure`,
    )
  ).rows[0]
  assert.equal(privileges.service, true)
  assert.equal(privileges.prosecdef, false)
  console.log(
    'PASS: partner decisions, replay, ownership, fee accumulation, rollback and browser denial (isolated local database)',
  )
} finally {
  await db.close()
}
