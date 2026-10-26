// Synthetic local PostgreSQL only. No credentials, .env, provider or network.
import { PGlite } from '../../gap-test-runtime/node_modules/@electric-sql/pglite/dist/index.js'
import assert from 'node:assert/strict'
import { setupFirstMessageFixture } from './first-message-db-fixture.mjs'
const db = new PGlite()
let count = 0
const pass = (s) => {
  count++
  console.log('PASS ' + s)
}
try {
  const f = await setupFirstMessageFixture(db),
    sid = 'SM' + 'a'.repeat(32)
  let id = await f.preview()
  assert.equal((await f.claim(id)).claimed, true)
  assert.equal(
    (await db.query('select count(*)::int n from conversations')).rows[0].n,
    0,
  )
  assert.equal((await f.claim(id)).claimed, false)
  pass(
    'atomic claim creates no fictional conversation and repeat claim cannot send',
  )
  const done = await f.finish(id, 'accepted', sid)
  assert.equal(done.history_recorded, true)
  assert.equal(
    (await f.finish(id, 'accepted', sid)).conversation_id,
    done.conversation_id,
  )
  assert.equal(
    (await db.query('select count(*)::int n from sms_logs')).rows[0].n,
    1,
  )
  assert.equal(
    (await db.query('select jsonb_array_length(messages) n from conversations'))
      .rows[0].n,
    1,
  )
  pass(
    'accepted SID atomically creates one conversation/message/SMS log; finish is idempotent',
  )
  await assert.rejects(
    () => f.finish(id, 'accepted', 'SM' + 'b'.repeat(32)),
    /SID mismatch/,
  )
  pass('an accepted outcome cannot be rebound to another provider message')
  await f.reset()
  id = await f.preview()
  await f.claim(id)
  await f.finish(id, 'unknown')
  assert.equal((await f.claim(await f.preview())).claimed, false)
  assert.equal(
    (await db.query('select count(*)::int n from conversations')).rows[0].n,
    0,
  )
  pass(
    'unknown result blocks a new preview from resending the phone and fabricates no history',
  )
  await f.reset()
  id = await f.preview()
  await f.claim(id)
  await f.finish(id, 'rejected')
  assert.equal((await f.claim(id)).claimed, false)
  assert.equal((await f.claim(await f.preview())).claimed, true)
  pass(
    'known rejection never reuses the attempt; only a distinct newly approved preview may claim',
  )
  await f.reset()
  id = await f.preview()
  await db.exec("update sms_marketing_consents set status='opted_out'")
  await assert.rejects(() => f.claim(id), /suppressed/)
  pass('latest opt-out blocks the send before any attempt')
  await f.reset()
  id = await f.preview()
  await db.exec(
    "insert into blacklist(phone,name)values('+17195550100','Blocked fixture')",
  )
  await assert.rejects(() => f.claim(id), /suppressed/)
  pass('blacklist blocks the send')
  await f.reset()
  id = await f.preview()
  await db.exec("update ops_customers set phone='+17195550101'")
  await assert.rejects(() => f.claim(id), /identity changed/)
  pass('customer phone/version change invalidates approval')
  await f.reset()
  id = await f.preview()
  await db.exec('update mcp_authorized_users set revoked_at=now()')
  await assert.rejects(() => f.claim(id), /owner contact grant/)
  pass('revoked owner grant prevents contact')
  await f.reset()
  id = await f.preview()
  await db.exec(
    'insert into conversations(phone_number,messages)values(\'+17195550100\',\'[{"role":"user","content":"Wait"}]\')',
  )
  await assert.rejects(() => f.claim(id), /appeared after preview/)
  pass(
    'inbound or owner conversation appearing after preview stops first contact',
  )
  await f.reset()
  id = await f.preview()
  await f.claim(id)
  await db.exec(
    'insert into conversations(phone_number,messages)values(\'+17195550100\',\'[{"role":"user","content":"Hello"}]\')',
  )
  await f.finish(id, 'accepted', sid)
  assert.equal(
    (await db.query('select jsonb_array_length(messages) n from conversations'))
      .rows[0].n,
    2,
  )
  pass(
    'accepted finalization preserves an inbound message racing with provider acceptance',
  )
  await f.reset()
  id = await f.preview()
  await db.exec("update staff_users set role='tech'")
  await assert.rejects(() => f.claim(id), /owner contact grant/)
  await db.exec("update staff_users set role='owner'")
  pass('non-owner cannot claim even with a contact scope')
  await f.reset()
  id = await f.preview()
  await db.query(
    "update mcp_action_previews set expires_at=now()-interval '1 second' where id=$1",
    [id],
  )
  await assert.rejects(() => f.claim(id), /unexpired/)
  pass('expired action cannot contact a customer')
  await f.reset()
  id = await f.preview()
  await db.exec(
    "insert into ops_customers(id,full_name,phone)values('30000000-0000-4000-8000-000000000002','Duplicate identity','+17195550100')",
  )
  await assert.rejects(() => f.claim(id), /Ambiguous customer phone/)
  pass('duplicate customer phone requires identity review rather than sending')
  const roles = (
    await db.query(
      "select has_table_privilege('authenticated','mcp_first_message_attempts','select') client,has_function_privilege('anon','claim_mcp_first_message(uuid,uuid)','execute') anon,has_function_privilege('service_role','claim_mcp_first_message(uuid,uuid)','execute') server",
    )
  ).rows[0]
  assert.deepEqual(roles, { client: false, anon: false, server: true })
  pass(
    'private ledger and owner-checked RPCs do not broaden browser permissions',
  )
  console.log(`Passed ${count} synthetic first-contact database scenarios`)
} finally {
  await db.close()
}
