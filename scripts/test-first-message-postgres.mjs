// Real independent PostgreSQL sessions in an ephemeral localhost-only container.
// Uses only the installed official postgres:17-alpine image; no .env, mounts or production URL.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { setupFirstMessageFixture } from './first-message-db-fixture.mjs'
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
  const f = await setupFirstMessageFixture({
    query: (...a) => pool.query(...a),
    exec: (s) => pool.query(s),
  })
  const one = await pool.connect(),
    two = await pool.connect()
  try {
    const a = await f.preview(),
      b = await f.preview()
    await one.query('begin')
    assert.equal((await f.claim(a, one)).claimed, true)
    let resolved = false
    const competing = f.claim(b, two).then((r) => {
      resolved = true
      return r
    })
    await sleep(100)
    assert.equal(resolved, false)
    await one.query('commit')
    assert.equal((await competing).claimed, false)
    console.log(
      'PASS independent concurrent first-contact approvals yield only one provider claim',
    )
    const sid = 'SM' + 'a'.repeat(32)
    const results = await Promise.all([
      f.finish(a, 'accepted', sid, one),
      f.finish(a, 'accepted', sid, two),
    ])
    assert.equal(results[0].conversation_id, results[1].conversation_id)
    assert.equal(
      (await pool.query('select count(*)::int n from conversations')).rows[0].n,
      1,
    )
    assert.equal(
      (await pool.query('select count(*)::int n from sms_logs')).rows[0].n,
      1,
    )
    assert.equal(
      (
        await pool.query(
          'select jsonb_array_length(messages) n from conversations',
        )
      ).rows[0].n,
      1,
    )
    console.log(
      'PASS concurrent provider finalization preserves exactly one conversation, message and SMS log',
    )
  } finally {
    one.release()
    two.release()
  }
} finally {
  if (pool) await pool.end()
  if (container) {
    docker(['rm', '--force', '--volumes', container])
    console.log(`Removed only test container ${name}`)
  }
}
