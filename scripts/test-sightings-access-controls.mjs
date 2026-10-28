// Isolated local PostgreSQL only. No env files, credentials or production requests.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
const { PGlite } = await import(
  process.env.PGLITE_MODULE || '@electric-sql/pglite'
)
const db = new PGlite()
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const uid = {
  owner: id(1),
  tech: id(2),
  marketing: id(3),
  stranger: id(4),
  anonymous: id(5),
  inactive: id(6),
  partner: id(7),
  admin: id(8),
  other: id(9),
}
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role supabase_admin;
    create schema auth;create schema storage;
    create table auth.users(id uuid primary key,is_anonymous boolean default false,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,storage to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text);
    alter table storage.objects enable row level security;grant select,insert on storage.objects to anon,authenticated;
    create policy "Anyone can upload sighting images" on storage.objects for insert with check(bucket_id='sighting-images');
    create policy "Authenticated users can upload images" on storage.objects for insert to authenticated with check(bucket_id='job-images');
    create policy "Public can view job images" on storage.objects for select using(bucket_id='job-images');
    create policy "Public can view sighting images" on storage.objects for select using(bucket_id='sighting-images');
    alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
    alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;
    alter default privileges for role supabase_admin in schema public grant select on tables to anon;
  `)
  const names = JSON.parse(
    await readFile(
      new URL('./fixtures/sightings-access-table-names.json', import.meta.url),
      'utf8',
    ),
  )
  for (const name of names) {
    assert.match(name, /^[a-z0-9_]+$/)
    await db.exec(`create table public.${name}(
      id uuid primary key default gen_random_uuid(),user_id uuid,role text default 'partner',is_active boolean default true,
      partner_id uuid,shift_id uuid,staff_user_id uuid,source text,status text default 'published',is_public boolean default true,
      name text,email text,phone text,company_name text,company_website text,home_address text,
      backlink_opted_in boolean default false,backlink_verified boolean default false,credit_balance numeric default 0,
      referral_balance_owed numeric default 0,partner_type text default 'referral',reward_tier int default 0,total_taps int default 0,total_conversions int default 0,card_id text,pin text,
      annual_revenue_goal numeric,available_hours_per_week int,work_weeks_per_year int,hiring_threshold numeric,hiring_consecutive_weeks int,updated_at timestamptz,ai_agent_api_enabled boolean default false);
      alter table public.${name} enable row level security;`)
  }
  await db.exec(`alter table public.system_settings disable row level security;alter table public.ops_payments disable row level security;
    create view public.ops_invoice_payment_totals as select id from public.ops_payments;
    create view public.restoration_equipment_billing as select id from public.restoration_projects;
    create view public.reactivation_template_results as select id from public.reactivation_email_log;
    create function public.current_app_role() returns text language sql as $$select null::text$$;
    create function public.app_has_role(allowed_roles text[]) returns boolean language sql as $$select false$$;
    create policy "ops_batch_invoices_read" on public.ops_batch_invoices for select using(auth.uid() in(select id from auth.users where raw_user_meta_data->>'role'='owner'));
    create policy "Create own partner record" on public.partners for insert with check(auth.uid()=user_id);
    create policy "Read own partner record" on public.partners for select using(auth.uid()=user_id);
    create policy "Update own partner record" on public.partners for update using(auth.uid()=user_id);
  `)
  const functions = [
    'update_conversations_updated_at()',
    'restoration_estimate_line_sync()',
    'set_ranger_updated_at()',
    'fn_log_deleted_record()',
    'backfill_call_log_recordings()',
    'tg_normalize_customer_name_case()',
    'tg_normalize_address_case()',
    'restoration_equipment_days()',
    'normalize_name_case(text)',
    'restoration_reading_taken_at()',
    'attribute_reactivation_click()',
    'cleanup_orphan_plan_nodes()',
    'increment_promo_use_count(uuid)',
    'link_customer_media_by_phone()',
    'notify_appointment_booked()',
    'sync_restoration_quoted_total()',
  ]
  for (const f of functions)
    await db.exec(
      `create function public.${f} returns void language plpgsql as $$begin return;end;$$`,
    )
  for (const [kind, user] of Object.entries(uid))
    await db.query('insert into auth.users values($1,$2,$3)', [
      user,
      kind === 'anonymous',
      JSON.stringify({ role: 'owner' }),
    ])
  for (const kind of ['owner', 'tech', 'marketing', 'inactive'])
    await db.query(
      'insert into public.staff_users(user_id,role,is_active) values($1,$2,$3)',
      [uid[kind], kind === 'inactive' ? 'owner' : kind, kind !== 'inactive'],
    )
  for (const kind of ['partner', 'admin', 'other'])
    await db.query(
      "insert into public.partners(id,user_id,name,email,company_name,role) values($1,$1,'Fixture','fixture@example.test','Fixture Co',$2)",
      [uid[kind], kind === 'admin' ? 'admin' : 'partner'],
    )
  for (const t of [
    'jobs',
    'sightings',
    'services',
    'lead_source_options',
    'ops_batch_invoices',
    'system_settings',
    'ops_payments',
    'radar_domains',
  ])
    await db.exec(`insert into public.${t} default values`)
  await db.query('insert into public.referrals(partner_id) values($1),($2)', [
    uid.partner,
    uid.other,
  ])
  await db.exec(
    "insert into storage.objects(bucket_id) values('job-images'),('sighting-images'),('customer-media')",
  )
  const migrationName = (
    await readdir(new URL('../supabase/migrations/', import.meta.url))
  ).find((n) => n.endsWith('_harden_sightings_access_controls.sql'))
  const migration = await readFile(
    new URL('../supabase/migrations/' + migrationName, import.meta.url),
    'utf8',
  )
  await db.exec(migration)
  let checks = 0
  const as = async (role, user, sql, args = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user || '',
    ])
    await db.exec(`set role ${role}`)
    try {
      return await db.query(sql, args)
    } finally {
      await db.exec('reset role')
    }
  }
  const deny = async (role, user, sql, args = []) => {
    await assert.rejects(
      as(role, user, sql, args),
      /permission denied|row-level security/,
    )
    checks++
  }
  const count = async (role, user, table) =>
    Number(
      (await as(role, user, `select count(*) n from public.${table}`)).rows[0]
        .n,
    )
  for (const t of [
    'jobs',
    'sightings',
    'system_settings',
    'ops_payments',
    'agent_api_keys',
    'restoration_projects',
    'outreach_measurement_receipts',
  ])
    await deny('anon', null, `select * from public.${t}`)
  for (const t of [
    'system_settings',
    'ops_payments',
    'agent_api_keys',
    'restoration_projects',
    'quickbooks_oauth_tokens',
  ])
    await deny('authenticated', uid.owner, `select * from public.${t}`)
  for (const user of [uid.stranger, uid.anonymous, uid.inactive, uid.partner]) {
    assert.equal(
      (
        await as(
          'authenticated',
          user,
          "select public.app_has_role(array['owner']) allowed",
        )
      ).rows[0].allowed,
      false,
    )
    checks++
    assert.equal(await count('authenticated', user, 'ops_batch_invoices'), 0)
    checks++
    assert.equal(await count('authenticated', user, 'jobs'), 0)
    checks++
  }
  for (const user of [uid.owner, uid.tech, uid.marketing, uid.admin]) {
    assert.equal(await count('authenticated', user, 'jobs'), 1)
    checks++
  }
  assert.equal(await count('authenticated', uid.owner, 'ops_batch_invoices'), 1)
  checks++
  await deny('anon', null, 'select public.current_app_role()')
  assert.equal(await count('anon', null, 'services'), 1)
  checks++
  assert.equal(await count('anon', null, 'lead_source_options'), 1)
  checks++
  await deny('anon', null, 'insert into public.services default values')
  await deny(
    'authenticated',
    uid.owner,
    "update public.radar_domains set name='changed'",
  )
  assert.equal(await count('authenticated', uid.marketing, 'radar_domains'), 1)
  checks++
  assert.equal(await count('authenticated', uid.partner, 'referrals'), 1)
  checks++
  await deny(
    'authenticated',
    uid.partner,
    "update public.partners set role='admin' where user_id=$1",
    [uid.partner],
  )
  await deny(
    'authenticated',
    uid.partner,
    'update public.partners set credit_balance=100 where user_id=$1',
    [uid.partner],
  )
  await deny(
    'authenticated',
    uid.partner,
    'insert into public.referrals(partner_id) values($1)',
    [uid.partner],
  )
  await deny(
    'authenticated',
    uid.partner,
    "update public.outbound_referrals set status='accepted'",
  )
  await deny(
    'authenticated',
    uid.stranger,
    "insert into public.partners(user_id,name,email,company_name,role,credit_balance) values($1,'Fixture','f@example.test','Co','admin',0)",
    [uid.stranger],
  )
  await deny(
    'authenticated',
    uid.stranger,
    "insert into public.partners(user_id,name,email,company_name,role,credit_balance) values($1,'Fixture','f@example.test','Co','partner',100)",
    [uid.stranger],
  )
  await deny(
    'authenticated',
    uid.anonymous,
    "insert into public.partners(user_id,name,email,company_name,role,credit_balance) values($1,'Fixture','f@example.test','Co','partner',0)",
    [uid.anonymous],
  )
  await as(
    'authenticated',
    uid.stranger,
    "insert into public.partners(user_id,name,email,company_name,role,credit_balance) values($1,'Fixture','f@example.test','Co','partner',0)",
    [uid.stranger],
  )
  checks++
  await as(
    'authenticated',
    uid.partner,
    "update public.partners set name='New profile name' where user_id=$1",
    [uid.partner],
  )
  checks++
  await deny(
    'authenticated',
    uid.partner,
    'insert into public.settings(user_id,annual_revenue_goal) values($1,123)',
    [uid.partner],
  )
  await as(
    'authenticated',
    uid.owner,
    'insert into public.settings(user_id,annual_revenue_goal,updated_at) values($1,123,now())',
    [uid.owner],
  )
  checks++
  await as(
    'authenticated',
    uid.owner,
    'update public.settings set annual_revenue_goal=456 where user_id=$1',
    [uid.owner],
  )
  checks++
  await deny(
    'authenticated',
    uid.owner,
    'update public.settings set ai_agent_api_enabled=true where user_id=$1',
    [uid.owner],
  )
  await deny(
    'authenticated',
    uid.owner,
    'update public.settings set user_id=$1',
    [uid.partner],
  )
  await deny(
    'anon',
    null,
    "insert into storage.objects(bucket_id) values('sighting-images')",
  )
  await deny(
    'authenticated',
    uid.partner,
    "insert into storage.objects(bucket_id) values('job-images')",
  )
  await as(
    'authenticated',
    uid.tech,
    "insert into storage.objects(bucket_id) values('job-images')",
  )
  checks++
  await deny(
    'authenticated',
    uid.tech,
    "insert into storage.objects(bucket_id) values('customer-media')",
  )
  assert.equal(
    Number(
      (await as('anon', null, 'select count(*) n from storage.objects')).rows[0]
        .n,
    ),
    3,
  )
  checks++
  const details = (
    await db.query(
      "select proname,prosecdef,proconfig from pg_proc where oid in('public.current_app_role()'::regprocedure,'public.app_has_role(text[])'::regprocedure)",
    )
  ).rows
  assert.ok(
    details.every(
      (f) => f.prosecdef && f.proconfig.includes('search_path=public, pg_temp'),
    ),
  )
  checks++
  for (const f of functions) {
    const row = (
      await db.query(
        'select proconfig from pg_proc where oid=$1::regprocedure',
        ['public.' + f],
      )
    ).rows[0]
    if (functions.indexOf(f) < 10) {
      assert.ok(row.proconfig.includes('search_path=public, pg_temp'))
      checks++
    }
  }
  for (const f of [
    'attribute_reactivation_click()',
    'backfill_call_log_recordings()',
    'cleanup_orphan_plan_nodes()',
    'increment_promo_use_count(uuid)',
    'link_customer_media_by_phone()',
    'notify_appointment_booked()',
    'sync_restoration_quoted_total()',
  ]) {
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('authenticated',$1,'execute') ok",
          ['public.' + f],
        )
      ).rows[0].ok,
      false,
    )
    checks++
  }
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity",
      )
    ).rows[0].n,
    0,
  )
  checks++
  await db.exec(
    'create table public.fixture_future(id bigint generated always as identity);create function public.fixture_future_rpc() returns int language sql as $$select 1$$',
  )
  for (const role of ['anon', 'authenticated']) {
    const r = (
      await db.query(
        "select has_table_privilege($1,'public.fixture_future','select') tbl,has_function_privilege($1,'public.fixture_future_rpc()','execute') fn,has_sequence_privilege($1,'public.fixture_future_id_seq','usage') seq",
        [role],
      )
    ).rows[0]
    assert.deepEqual(r, { tbl: false, fn: false, seq: false })
    checks++
  }
  assert.ok(
    (
      await db.query(
        "select defaclacl::text acl from pg_default_acl where defaclrole='supabase_admin'::regrole",
      )
    ).rows.some((r) => r.acl.includes('anon=r/')),
  )
  checks++
  console.log(
    `PASS: ${checks} local access checks; forged metadata/role/credits blocked; staff, safe partner profile and public catalogs preserved; storage/default privileges verified`,
  )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await db.close()
}
