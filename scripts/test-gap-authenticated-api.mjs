// Run only against the disposable stack created by test-gap-authenticated-app.mjs.
import pg from 'pg'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createServerClient } from '@supabase/ssr'
const s = JSON.parse(
  await readFile(
    new URL('../../gap-auth-runtime/state.json', import.meta.url),
    'utf8',
  ),
)
assert.equal(new URL(s.appUrl).hostname, '127.0.0.1')
assert.equal(new URL(s.base).hostname, '127.0.0.1')
const d = new pg.Client({
  host: '127.0.0.1',
  port: s.dbPort,
  user: 'postgres',
  password: 'synthetic-fixture-only',
})
await d.connect()
for (const user of s.users) {
  const jar = []
  const auth = createServerClient(s.base, s.anon, {
    cookies: { getAll: () => [], setAll: (items) => jar.push(...items) },
  })
  const login = await auth.auth.signInWithPassword({
    email: user.email,
    password: s.password,
  })
  if (login.error) throw login.error
  const verified = await auth.auth.getUser()
  assert.equal(verified.data.user.id, user.id)
  const key =
    user.role === 'owner'
      ? 'owner'
      : user.email.startsWith('tech@')
        ? 'tech'
        : 'outsider'
  s.sessions[key] = {
    cookie: jar.map((c) => c.name + '=' + c.value).join('; '),
    token: login.data.session.access_token,
  }
}

let count = 0
const decode = (body) =>
  JSON.parse(
    body.startsWith('event:')
      ? body
          .split('\n')
          .find((line) => line.startsWith('data: '))
          .slice(6)
      : body,
  )
const pass = (message) => {
  count++
  console.log('PASS ' + message)
}
async function mcp(token, name, args = {}) {
  const r = await fetch(s.appUrl + '/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-forwarded-proto': 'https',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: name === 'tools/list' ? name : 'tools/call',
      params: name === 'tools/list' ? {} : { name, arguments: args },
    }),
  })
  return { status: r.status, body: await r.text() }
}
const old = (
  await d.query(
    'select scopes from public.mcp_authorized_users where user_id=$1',
    [s.ids.owner],
  )
).rows[0].scopes
try {
  let r = await mcp(null, 'tools/list')
  assert.equal(r.status, 401)
  pass('unauthenticated MCP denied 401')
  r = await mcp(s.sessions.tech.token, 'tools/list')
  assert.equal(r.status, 401)
  pass('signed-in technician denied owner-only MCP')
  r = await mcp(s.sessions.owner.token, 'tools/list')
  assert.equal(r.status, 200, r.body)
  const list = decode(r.body)
  for (const name of [
    'get_schedule_gaps',
    'get_gap_candidates',
    'get_gap_outreach',
    'preview_gap_outreach',
    'execute_gap_outreach',
    'stop_gap_outreach',
  ])
    assert.ok(list.result.tools.some((t) => t.name === name))
  pass(
    'all six new tools discovered using a real Auth-issued ES256 owner token and local JWKS',
  )
  await d.query(
    "insert into public.mcp_authorized_users(user_id,scopes) values($1,array['business:read']) on conflict(user_id) do update set scopes=array['business:read'],revoked_at=null",
    [s.users[1].id],
  )
  const techLogin = await fetch(s.base + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: s.anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: s.users[1].email, password: s.password }),
  })
  const techSession = await techLogin.json()
  assert.ok(techSession.access_token)
  r = await mcp(techSession.access_token, 'tools/list')
  assert.equal(r.status, 401)
  pass(
    'non-owner remains denied even with real signed business claims and a database read grant',
  )
  await d.query('delete from public.mcp_authorized_users where user_id=$1', [
    s.users[1].id,
  ])
  await d.query(
    "insert into public.availability_templates(staff_user_id,day_of_week,start_time,end_time,slot_interval_minutes,is_active) select $1,extract(dow from $2::date)::int,'09:00','18:00',60,true where not exists(select 1 from public.availability_templates where staff_user_id=$1)",
    [s.ids.staff, s.ids.date],
  )
  for (const [start, end] of [
    ['09:00', '10:00'],
    ['13:00', '15:00'],
  ])
    await d.query(
      'insert into public.ops_appointments(customer_id,service_address_id,assigned_staff_user_id,appointment_date,start_time,end_time) select $1,$2,$3,$4,$5,$6 where not exists(select 1 from public.ops_appointments where assigned_staff_user_id=$3 and appointment_date=$4 and start_time=$5)',
      [s.ids.customer, s.ids.address, s.ids.staff, s.ids.date, start, end],
    )

  r = await mcp(s.sessions.owner.token, 'get_schedule_gaps', {
    start_date: s.ids.date,
    end_date: s.ids.date,
    required_minutes: 120,
  })
  assert.equal(r.status, 200)
  assert.ok(!decode(r.body).result?.isError, r.body)
  pass(
    'owner gap read passes real JWT, database grant and staff-role validation',
  )
  const currentGap = decode(r.body).result.structuredContent.data.find(
    (g) => g.internal,
  )
  assert.ok(currentGap)
  r = await mcp(s.sessions.owner.token, 'get_gap_candidates', {
    gap: currentGap,
    limit: 10,
  })
  assert.equal(r.status, 200)
  assert.ok(!decode(r.body).result?.isError, r.body)
  pass(
    'candidate tool reads real local PostgREST sources with verified non-id pagination keys',
  )
  await d.query(
    'delete from public.sms_marketing_consents where customer_id=$1',
    [s.ids.customer],
  )
  await d.query(
    "insert into public.ops_sms_consent_events(customer_id,user_id,phone,action,source,owner_attested_at,evidence_ref,consent_text) values($1,$2,'+17195550100','owner_attested_existing_permission','owner_attestation',now(),$3,'Synthetic owner confirms prior permission; original customer opt-in date unknown') on conflict do nothing",
    [
      s.ids.customer,
      s.ids.owner,
      'synthetic-owner-approval#customer=' + s.ids.customer,
    ],
  )
  r = await mcp(s.sessions.owner.token, 'get_gap_candidates', {
    gap: currentGap,
    limit: 10,
  })
  const permissionResult = decode(r.body).result.structuredContent.result
  const recorded = [
    ...permissionResult.data,
    ...permissionResult.excluded,
  ].find((row) => row.customer_id === s.ids.customer)
  assert.equal(recorded.consent.status, 'owner_attested')
  assert.equal(recorded.consent.consented_at, null)
  pass(
    'real authenticated candidate read reports owner attestation separately from unknown customer opt-in date',
  )
  const batch = 'a0000000-0000-4000-8000-000000000009'
  await d.query(
    "insert into public.gap_outreach_batches(id,actor_user_id,idempotency_key,payload,payload_hash,gap_date,staff_id,start_time,end_time,status,expires_at) values($1,$2,'synthetic-read-state',$3,'synthetic',$4,$5,'10:00','13:00','stopped',now()+interval '10 minutes') on conflict(id) do nothing",
    [
      batch,
      s.ids.owner,
      { gap: currentGap, recipients: [] },
      s.ids.date,
      s.ids.staff,
    ],
  )
  r = await mcp(s.sessions.owner.token, 'get_gap_outreach', { batch_id: batch })
  assert.equal(r.status, 200)
  assert.ok(!decode(r.body).result?.isError, r.body)
  pass(
    'batch-state tool reads the synthetic stopped ledger without resuming it',
  )

  r = await mcp(s.sessions.owner.token, 'execute_gap_outreach', {
    confirmation_id: 'a0000000-0000-4000-8000-000000000001',
    confirmed: true,
  })
  assert.ok(/disabled|GAP_OUTREACH_ENABLED/.test(r.body), r.body)
  pass('activation-off rejects execution before the provider sender')
  await d.query(
    "update public.mcp_authorized_users set scopes=array['business:read'] where user_id=$1",
    [s.ids.owner],
  )
  const gap = {
    date: s.ids.date,
    staff_id: s.ids.staff,
    staff_name: 'Synthetic owner',
    start_time: '10:00',
    end_time: '13:00',
    minutes: 180,
    internal: true,
    version: 'a'.repeat(64),
    before: null,
    after: null,
    slots: [],
  }
  for (const [name, args] of [
    [
      'preview_gap_outreach',
      {
        gap,
        customer_ids: [s.ids.customer],
        idempotency_key: 'local-auth-scope-test',
      },
    ],
    [
      'execute_gap_outreach',
      {
        confirmation_id: 'a0000000-0000-4000-8000-000000000001',
        confirmed: true,
      },
    ],
    ['stop_gap_outreach', { batch_id: 'a0000000-0000-4000-8000-000000000001' }],
  ]) {
    r = await mcp(s.sessions.owner.token, name, args)
    assert.ok(r.body.includes('outreach:write'), r.body)
    pass(
      'removed database outreach grant blocks ' +
        name +
        ' despite stale token claims',
    )
  }
  await d.query(
    "update public.mcp_authorized_users set scopes=array['business:read','outreach:write'] where user_id=$1",
    [s.ids.owner],
  )
  for (const [name, args] of [
    [
      'preview_gap_outreach',
      {
        gap,
        customer_ids: [s.ids.customer],
        idempotency_key: 'local-contact-scope-test',
      },
    ],
    [
      'execute_gap_outreach',
      {
        confirmation_id: 'a0000000-0000-4000-8000-000000000001',
        confirmed: true,
      },
    ],
  ]) {
    r = await mcp(s.sessions.owner.token, name, args)
    assert.ok(r.body.includes('customer:contact'), r.body)
    pass('missing customer-contact grant blocks ' + name)
  }
  await d.query(
    'update public.mcp_authorized_users set scopes=$2,revoked_at=now() where user_id=$1',
    [s.ids.owner, old],
  )
  r = await mcp(s.sessions.owner.token, 'tools/list')
  assert.equal(r.status, 401)
  pass('revoked owner grant immediately rejects the existing signed token')
  await d.query(
    'update public.mcp_authorized_users set revoked_at=null where user_id=$1',
    [s.ids.owner],
  )
  for (const who of ['owner', 'tech']) {
    const response = await fetch(
      s.appUrl + '/api/admin/ops/invoices/' + s.jobs[0].invoice,
      { headers: { Cookie: s.sessions[who].cookie } },
    )
    assert.equal(response.status, 200, who)
    pass(
      who +
        ' real session cookie passes active staff-role and invoice access checks',
    )
  }
  const outsider = await fetch(
      s.appUrl + '/api/admin/ops/invoices/' + s.jobs[0].invoice,
      { headers: { Cookie: s.sessions.outsider.cookie } },
    ),
    denied = await outsider.json()
  assert.notEqual(outsider.status, 200)
  assert.ok(!denied.invoice)
  pass(
    'unrelated tech receives no invoice data (legacy generic ' +
      outsider.status +
      ' error)',
  )
  const anonymous = await fetch(s.appUrl + '/tech/jobs/' + s.jobs[0].job, {
    redirect: 'manual',
  })
  assert.equal(anonymous.status, 307)
  assert.ok(anonymous.headers.get('location').includes('/auth/login'))
  pass('protected UI redirects to login without a session cookie')
  assert.equal(
    (await d.query('select count(*)::int n from public.sms_logs')).rows[0].n,
    0,
  )
  assert.equal(
    (
      await d.query(
        'select count(*)::int n from public.gap_outreach_recipients',
      )
    ).rows[0].n,
    0,
  )
  pass('authorization checks created no send records or outreach recipients')
  console.log(
    `Passed ${count} real local authenticated API/authorization checks. No auth mock, forged user token or provider sender used.`,
  )
} finally {
  await d.query(
    'update public.mcp_authorized_users set scopes=$2,revoked_at=null where user_id=$1',
    [s.ids.owner, old],
  )
  await d.query('delete from public.mcp_authorized_users where user_id=$1', [
    s.users[1].id,
  ])
  await d.end()
}
