// Disposable real Supabase Auth + PostgREST + Next app. No production credentials.
// Keep this process alive while exercising the localhost UI; Ctrl-C cleans only its resources.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import pg from 'pg'
import { createServerClient } from '@supabase/ssr'
import { seedAuthenticatedFixtures } from './seed-gap-authenticated-fixtures.mjs'
import { setupSyntheticGapDatabase } from './gap-outreach-db-fixture.mjs'
const runtime = new URL('../../gap-auth-runtime/', import.meta.url)
await mkdir(runtime, { recursive: true })
const label = `sightings-gap-auth-${randomUUID().slice(0, 8)}`
const created = [],
  state = { label, containers: created, runnerPid: process.pid }
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let pool, gateway, app
async function freePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}
async function run(image, alias, env) {
  const id = docker([
    'run',
    '--detach',
    '--pull=never',
    '--name',
    `${label}-${alias}`,
    '--label',
    `com.sasquatch.fixture=${label}`,
    '--network',
    label,
    '--network-alias',
    alias,
    '--publish',
    `127.0.0.1::${alias === 'db' ? 5432 : alias === 'auth' ? 9999 : 3000}`,
    ...Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`]),
    image,
  ])
  created.push(id)
  await writeFile(
    new URL('state.json', runtime),
    JSON.stringify(state, null, 2),
  )
  const info = JSON.parse(docker(['inspect', id]))[0]
  const port = alias === 'db' ? 5432 : alias === 'auth' ? 9999 : 3000
  const binding = info.NetworkSettings.Ports[port + '/tcp']?.[0]
  if (!binding || binding.HostIp !== '127.0.0.1')
    throw new Error(
      'Fixture must publish only on localhost: ' +
        JSON.stringify(info.NetworkSettings.Ports) +
        ' ' +
        JSON.stringify(info.State) +
        ' ' +
        spawnSync('docker', ['logs', '--tail', '15', id], { encoding: 'utf8' })
          .stderr,
    )
  return Number(binding.HostPort)
}
async function wait(url) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {}
    await sleep(200)
  }
  throw new Error(`Not ready: ${url}`)
}
async function cleanup() {
  if (app) {
    try {
      process.kill(-app.pid, 'SIGTERM')
    } catch {}
  }
  if (gateway) (gateway.closeAllConnections(), gateway.close())
  if (pool) await pool.end()
  for (const id of [...created].reverse()) {
    try {
      docker(['rm', '--force', '--volumes', id])
    } catch {}
  }
  try {
    docker(['network', 'rm', label])
  } catch {}
  try {
    const current = JSON.parse(
      await readFile(new URL('state.json', runtime), 'utf8'),
    )
    if (current.label === label) await unlink(new URL('state.json', runtime))
  } catch {}
  console.log('Removed only authenticated fixture containers/network ' + label)
}
process.on('SIGINT', () => {
  cleanup().finally(() => process.exit(0))
})
process.on('SIGTERM', () => {
  cleanup().finally(() => process.exit(0))
})
try {
  docker([
    'network',
    'create',
    '--label',
    `com.sasquatch.fixture=${label}`,
    label,
  ])
  const dbPort = await run('postgres:17-alpine', 'db', {
    POSTGRES_PASSWORD: 'synthetic-fixture-only',
  })
  pool = new pg.Pool({
    host: '127.0.0.1',
    port: dbPort,
    user: 'postgres',
    password: 'synthetic-fixture-only',
    database: 'postgres',
  })
  for (let i = 0; i < 100; i++) {
    try {
      await pool.query('select 1')
      break
    } catch {
      await sleep(100)
    }
  }
  await pool.query(
    'create schema auth; alter role postgres set search_path=auth,public',
  )
  const gatewayPort = await freePort(),
    appPort = await freePort(),
    base = `http://127.0.0.1:${gatewayPort}`
  const secret = 'synthetic-local-only-secret-at-least-32-characters'
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const privateJwk = {
    ...privateKey.export({ format: 'jwk' }),
    kid: 'synthetic-ec',
    use: 'sig',
    alg: 'ES256',
    key_ops: ['sign', 'verify'],
  }
  const { d, ...publicJwk } = privateJwk
  const oct = {
    kty: 'oct',
    kid: 'synthetic-hmac',
    key_ops: ['verify'],
    k: Buffer.from(secret).toString('base64url'),
    alg: 'HS256',
  }
  const jwt = (role) => {
    const h = Buffer.from(
        JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'synthetic-hmac' }),
      ).toString('base64url'),
      p = Buffer.from(
        JSON.stringify({
          role,
          iss: 'supabase',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 86400,
        }),
      ).toString('base64url')
    return (
      h +
      '.' +
      p +
      '.' +
      createHmac('sha256', secret)
        .update(h + '.' + p)
        .digest('base64url')
    )
  }
  const anon = jwt('anon'),
    service = jwt('service_role')
  const authPort = await run(
    'public.ecr.aws/supabase/gotrue:v2.187.0',
    'auth',
    {
      GOTRUE_API_HOST: '0.0.0.0',
      GOTRUE_API_PORT: '9999',
      API_EXTERNAL_URL: base,
      GOTRUE_DB_DRIVER: 'postgres',
      GOTRUE_DB_DATABASE_URL:
        'postgres://postgres:synthetic-fixture-only@db:5432/postgres',
      DB_NAMESPACE: 'auth',
      GOTRUE_SITE_URL: `http://127.0.0.1:${appPort}`,
      GOTRUE_URI_ALLOW_LIST: `http://127.0.0.1:${appPort}`,
      GOTRUE_JWT_SECRET: secret,
      GOTRUE_JWT_KEYS: JSON.stringify([privateJwk, oct]),
      GOTRUE_JWT_ISSUER: base + '/auth/v1',
      GOTRUE_JWT_ADMIN_ROLES: 'service_role',
      GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
      GOTRUE_JWT_AUD: 'authenticated',
      GOTRUE_JWT_EXP: '3600',
      GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
      GOTRUE_MAILER_AUTOCONFIRM: 'true',
      GOTRUE_DISABLE_SIGNUP: 'true',
      GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: 'true',
      GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI:
        'pg-functions://postgres/public/custom_access_token_hook',
    },
  )
  await wait(`http://127.0.0.1:${authPort}/health`)
  const users = [
    {
      id: '10000000-0000-4000-8000-000000000001',
      email: 'owner@fixture.example.test',
      role: 'owner',
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      email: 'tech@fixture.example.test',
      role: 'tech',
    },
    {
      id: '10000000-0000-4000-8000-000000000003',
      email: 'outsider@fixture.example.test',
      role: 'tech',
    },
  ]
  for (const user of users) {
    const r = await fetch(`http://127.0.0.1:${authPort}/admin/users`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + service,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: user.id,
        email: user.email,
        password: 'Synthetic-test-password-732!',
        email_confirm: true,
        role: 'authenticated',
      }),
    })
    if (!r.ok) throw new Error('Local Auth user creation: ' + (await r.text()))
    const createdUser = await r.json()
    if (createdUser.id !== user.id)
      throw new Error('Local Auth returned unexpected ID')
  }
  const ids = await setupSyntheticGapDatabase(
    { query: (...args) => pool.query(...args), exec: (sql) => pool.query(sql) },
    { existingAuth: true },
  )
  const schema = JSON.parse(
    await readFile(
      new URL('./fixtures/gap-auth-schema.json', import.meta.url),
      'utf8',
    ),
  )
  const tables = [...new Set(schema.columns.map((c) => c.table))]
  for (const table of tables)
    await pool.query(
      `create table if not exists public.${table} (id uuid default gen_random_uuid())`,
    )
  for (const c of schema.columns)
    await pool.query(
      `alter table public.${c.table} add column if not exists ${c.column} ${c.type}`,
    )
  // Add fixture relationship keys matching PostgREST's actual nested selects.
  for (const table of tables) {
    const has = await pool.query(
      "select 1 from pg_constraint where conrelid=$1::regclass and contype='p'",
      ['public.' + table],
    )
    if (
      !has.rowCount &&
      ![
        'hcp_customer_history',
        'qb_historical_transactions',
        'sms_marketing_consents',
        'tomorrow_fill_settings',
      ].includes(table)
    )
      await pool.query(`alter table public.${table} add primary key(id)`)
  }
  for (const fk of schema.foreign_keys) {
    const exists = await pool.query(
      'select 1 from pg_constraint where conname=$1 and conrelid=$2::regclass',
      [fk.name, 'public.' + fk.table],
    )
    const target = fk.definition.match(/REFERENCES (?:public\.)?([^ (]+)/)?.[1]
    if (
      !exists.rowCount &&
      (tables.includes(target) || target === 'auth.users')
    ) {
      try {
        await pool.query(
          `alter table public.${fk.table} add constraint ${fk.name} ${fk.definition}`,
        )
      } catch (error) {
        console.log('Fixture FK omitted ' + fk.name + ': ' + error.message)
      }
    }
  }
  await pool.query(`alter role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role; grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;
    create function public.custom_access_token_hook(event jsonb) returns jsonb language plpgsql as $$ declare claims jsonb; scopes text[]; begin claims:=event->'claims'; select a.scopes into scopes from public.mcp_authorized_users a where a.user_id=(event->>'user_id')::uuid and revoked_at is null; if scopes is not null then claims:=claims||jsonb_build_object('aud','https://sightings.sasquatchcarpet.com/mcp','client_id','synthetic-local-client','mcp_access','business:read','mcp_scopes',scopes); end if; return jsonb_set(event,'{claims}',claims); end $$;`)
  await pool.query(
    "insert into staff_users(id,user_id,display_name,role,is_active) values('20000000-0000-4000-8000-000000000002',$1,'Synthetic tech','tech',true),('20000000-0000-4000-8000-000000000003',$2,'Synthetic other tech','tech',true)",
    [users[1].id, users[2].id],
  )
  await pool.query(
    "update staff_users set default_open=true,add_on_bonus_rate=0,invoice_growth_bonus_starts_on='2099-01-01' where user_id=$1",
    [ids.owner],
  )
  const restPort = await run(
    'public.ecr.aws/supabase/postgrest:v14.1',
    'rest',
    {
      PGRST_DB_URI:
        'postgres://postgres:synthetic-fixture-only@db:5432/postgres',
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: JSON.stringify({ keys: [publicJwk, oct] }),
      PGRST_SERVER_PORT: '3000',
    },
  )
  await wait(`http://127.0.0.1:${restPort}/`)
  gateway = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', `http://127.0.0.1:${appPort}`)
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    )
    res.setHeader('Access-Control-Expose-Headers', '*')
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
    const auth = req.url.startsWith('/auth/v1/'),
      rest = req.url.startsWith('/rest/v1/')
    if (!auth && !rest) {
      res.writeHead(404).end()
      return
    }
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const r = await fetch(
        `http://127.0.0.1:${auth ? authPort : restPort}` +
          req.url.replace(auth ? '/auth/v1' : '/rest/v1', ''),
        {
          method: req.method,
          headers: {
            ...req.headers,
            host: `127.0.0.1:${auth ? authPort : restPort}`,
          },
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        },
      )
      res.writeHead(
        r.status,
        Object.fromEntries(
          [...r.headers].filter(
            ([k]) =>
              ![
                'transfer-encoding',
                'content-encoding',
                'content-length',
                'access-control-allow-origin',
              ].includes(k),
          ),
        ),
      )
      res.end(Buffer.from(await r.arrayBuffer()))
    } catch (error) {
      res.writeHead(502).end(error.message)
    }
  })
  await new Promise((resolve) =>
    gateway.listen(gatewayPort, '127.0.0.1', resolve),
  )
  const jobs = await seedAuthenticatedFixtures(pool, ids)
  const sessions = {}
  for (const user of users) {
    const jar = []
    const auth = createServerClient(base, anon, {
      cookies: { getAll: () => [], setAll: (items) => jar.push(...items) },
    })
    const login = await auth.auth.signInWithPassword({
      email: user.email,
      password: 'Synthetic-test-password-732!',
    })
    if (login.error) throw login.error
    const key =
      user.role === 'owner'
        ? 'owner'
        : user.email.startsWith('tech@')
          ? 'tech'
          : 'outsider'
    sessions[key] = {
      cookie: jar.map((c) => c.name + '=' + c.value).join('; '),
      token: login.data.session.access_token,
    }
  }
  Object.assign(state, {
    jobs,
    sessions,
    dbPort,
    authPort,
    restPort,
    base,
    appUrl: `http://127.0.0.1:${appPort}`,
    anon,
    service,
    users,
    ids,
    password: 'Synthetic-test-password-732!',
  })
  await writeFile(
    new URL('state.json', runtime),
    JSON.stringify(state, null, 2),
  )
  const env = {
    ...Object.fromEntries(
      ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'SHELL']
        .filter((k) => process.env[k])
        .map((k) => [k, process.env[k]]),
    ),
    NEXT_PUBLIC_SUPABASE_URL: base,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
    OPENAI_API_KEY: 'sk-synthetic-disabled',
    RESEND_API_KEY: 're_synthetic_disabled',
    GAP_OUTREACH_ENABLED: 'false',
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: `--import ${new URL('./local-test-network-guard.mjs', import.meta.url).pathname}`,
  }
  // No ambient provider credentials are inherited.
  for (const key of Object.keys(env))
    if (
      /TWILIO|TELEGRAM|SENDGRID|RESEND|QUICKBOOKS|SQUARE|STRIPE|ONESIGNAL|ANTHROPIC|GOOGLE.*KEY|VERCEL.*TOKEN/.test(
        key,
      )
    )
      delete env[key]
  env.RESEND_API_KEY = 're_synthetic_disabled'
  app = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--webpack',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(appPort),
    ],
    {
      cwd: new URL('../', import.meta.url),
      env,
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  )
  console.log(
    'Local authenticated fixture ready; state file contains synthetic-only endpoints and credentials. ' +
      state.appUrl,
  )
  await new Promise((resolve, reject) => {
    app.on('exit', (code) =>
      code ? reject(new Error('Local app exited ' + code)) : resolve(),
    )
  })
} catch (error) {
  console.error(error)
  for (const id of created) {
    try {
      const logs = spawnSync('docker', ['logs', '--tail', '20', id], {
        encoding: 'utf8',
      })
      console.error(logs.stdout + logs.stderr)
    } catch {}
  }
  await cleanup()
  process.exitCode = 1
}
