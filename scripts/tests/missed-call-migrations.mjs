/** Runs only in a new, disposable, network-disabled PostgreSQL container. No production credentials. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const name = `sightings-call-test-${process.pid}-${Date.now()}`
function docker(args, input) {
 const result = spawnSync('docker', args, { input, encoding: 'utf8' })
 if (result.status !== 0) throw new Error(result.stderr || result.stdout)
 return result.stdout.trim()
}
const args = ['exec','-i',name,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1']
const sql = text => docker(args, text)
const sid = 'CA'+'1'.repeat(32), sid2 = 'CA'+'2'.repeat(32), recording = 'RE'+'3'.repeat(32)
const convo = '10000000-0000-4000-8000-000000000001', phone = '+17195550100'
const query = (call = sid, preview = false) => `select claim_call_follow_up('${phone}','${call}',null,${preview},'${convo}');`
const claim = (call = sid, preview = false) => JSON.parse(sql(query(call, preview)))
let checks = 0
async function check(label, run) { await run(); console.log('PASS', label); checks++ }
function race(text) {
 return new Promise((resolve, reject) => {
  const p = spawn('docker', args); let out = '', err = ''
  p.stdout.on('data', x => out += x); p.stderr.on('data', x => err += x)
  p.on('error', reject); p.on('close', code => code ? reject(new Error(err)) : resolve(JSON.parse(out.trim())))
  p.stdin.end(text)
 })
}
try {
 docker(['run','-d','--rm','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16'])
 for (let n=0; n<60; n++) {
  if (spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']).status === 0) break
  await new Promise(r => setTimeout(r, 250))
 }
 sql(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create table call_logs(id uuid default gen_random_uuid(),call_sid text unique not null,caller_phone text,direction text default 'inbound',outcome text default 'inbound',duration_seconds integer,recording_url text,transcription text,raw_dial_status text,created_at timestamptz default now(),updated_at timestamptz default now(),forwarding_required boolean default false,forwarding_accepted_at timestamptz,queue_worker_sid text);
 create table ops_customers(id uuid primary key default gen_random_uuid(),phone text);
 create table conversations(id uuid primary key default gen_random_uuid(),phone_number text,source text,status text,messages jsonb default '[]',ops_customer_id uuid,metadata jsonb default '{}',ai_enabled boolean default true,updated_at timestamptz default now());
 create table mcp_event_subscriptions(id text primary key,event_name text constraint mcp_event_subscriptions_event_name_check check(event_name='conversation.message.received'),status text,created_at timestamptz,expires_at timestamptz);
 create table mcp_event_deliveries(id text primary key,subscription_id text,event_name text constraint mcp_event_deliveries_event_name_check check(event_name='conversation.message.received'),payload jsonb,status text,occurred_at timestamptz);
 create table sms_marketing_consents(phone_normalized text,status text);
 create table ops_sms_consent_events(phone text,action text);
 create table mcp_first_message_attempts(phone text,status text);
 create table sms_logs(recipient_phone text,sent_at timestamptz,created_at timestamptz default now(),status text,message_type text);
 create table blacklist(phone text);
 create function gap_outreach_phone(text) returns text language sql immutable as $$ select case when length(regexp_replace($1,'[^0-9]','','g'))=10 then '+1'||regexp_replace($1,'[^0-9]','','g') else '+'||regexp_replace($1,'[^0-9]','','g') end $$;
 create function is_phone_blacklisted(text) returns boolean language sql as $$ select exists(select 1 from blacklist where right(gap_outreach_phone(phone),10)=right(gap_outreach_phone($1),10)) $$;
 grant select,insert,update on all tables in schema public to service_role;
 `)
 for (const file of ['20261112045648_missed_call_events.sql','20261112045735_call_follow_up_guard.sql'])
  sql(readFileSync(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'))
 const reset = () => sql(`
 truncate call_follow_up_claims,call_logs,conversations,mcp_event_subscriptions,mcp_event_deliveries,sms_logs,sms_marketing_consents,ops_sms_consent_events,mcp_first_message_attempts,blacklist;
 update call_follow_up_settings set activated_at=now()-interval '1 hour';
 insert into conversations(id,phone_number) values('${convo}','${phone}');
 insert into call_logs(call_sid,caller_phone,outcome,provider_started_at) values('${sid}','${phone}','no-answer',now()-interval '1 minute');
 insert into mcp_event_subscriptions values('sub','call.missed','active',now()-interval '30 minutes',null);
 insert into mcp_event_deliveries values('event','sub','call.missed',jsonb_build_object('call_sid','${sid}','conversation_id','${convo}'),'pending',now()-interval '1 minute');
 `)
 await check('both migrations install and RPC access is service-role only', () => {
  assert.equal(sql("select has_function_privilege('anon','claim_call_follow_up(text,text,text,boolean,uuid)','execute');"),'f')
  assert.equal(sql("select has_function_privilege('service_role','claim_call_follow_up(text,text,text,boolean,uuid)','execute');"),'t')
 })
 reset()
 await check('fresh preview is eligible and does not consume claim', () => {
  assert.equal(claim(sid,true).eligible,true)
  assert.equal(sql('select count(*) from call_follow_up_claims;'),'0')
  assert.equal(JSON.parse(sql('set role service_role;'+query(sid,true))).eligible,true)
 })
 await check('missing activation boundary fails closed', () => {
  sql('delete from call_follow_up_settings;')
  assert.equal(claim().eligible,false)
  sql("insert into call_follow_up_settings values(true,now()-interval '1 hour');")
 })
 await check('call-context creation stores no fictional message', () => {
  sql('delete from conversations;')
  const id=sql(`select ensure_missed_call_conversation('${sid}');`)
  assert.match(id,/^[0-9a-f-]{36}$/)
  assert.equal(sql(`select messages from conversations where id='${id}';`),'[]')
  assert.equal(sql(`select ensure_missed_call_conversation('${sid}');`),id)
 })
 for (const [label,mutation] of [
  ['historical provider start',"update call_logs set provider_started_at=now()-interval '2 hours'"],
  ['missing provider start','update call_logs set provider_started_at=null'],
  ['future provider start',"update call_logs set provider_started_at=now()+interval '1 hour'"],
  ['answered',"update call_logs set outcome='answered'"],
  ['forwarding accepted','update call_logs set forwarding_accepted_at=now()'],
  ['voicemail',"update call_logs set outcome='voicemail',recording_url='https://example.invalid/recording'"],
  ['recording regardless of missed flag',"update call_logs set recording_url='recording'"],
  ['transcription regardless of missed flag',"update call_logs set transcription='hello'"],
  ['discarded event',"update mcp_event_deliveries set status='discarded'"],
  ['wrong event conversation',"update mcp_event_deliveries set payload=jsonb_set(payload,'{conversation_id}','\"other\"')"],
  ['revoked subscription',"update mcp_event_subscriptions set status='revoked'"],
  ['subscription newer than call','update mcp_event_subscriptions set created_at=now()'],
  ['marketing opt-out',`insert into sms_marketing_consents values('${phone}','opted_out')`],
  ['service SMS opt-out',`insert into ops_sms_consent_events values('${phone}','opted_out')`],
  ['blacklist',`insert into blacklist values('${phone}')`],
  ['owner takeover via live Manual mode','update conversations set ai_enabled=false'],
  ['recent outbound',`insert into sms_logs(recipient_phone,sent_at,status,message_type) values('${phone}',now(),'accepted','admin_reply')`],
  ['outbound with missing status',`insert into sms_logs(recipient_phone,sent_at,status,message_type) values('${phone}',now(),null,'admin_reply')`],
  ['uncertain outbound',`insert into sms_logs(recipient_phone,sent_at,status,message_type) values('${phone}',now(),'unknown','admin_reply')`],
  ['unresolved first contact',`insert into mcp_first_message_attempts values('${phone}','unknown')`],
 ]) {
  reset(); sql(mutation)
  await check(`blocks ${label}`, () => assert.equal(claim().eligible,false))
 }
 reset()
 await check('incoming voicemail logs do not suppress outgoing follow-up', () => {
  sql(`insert into sms_logs(recipient_phone,sent_at,status,message_type) values('${phone}',now(),'received','voicemail_received');`)
  assert.equal(claim(sid,true).eligible,true)
 })
 reset()
 await check('canonical key is durable; accepted claim cannot repeat', () => {
  const c=claim(); assert.equal(c.eligible,true)
  assert.equal(sql('select idempotency_key from call_follow_up_claims;'),`missed-call:${sid}:v1`)
  sql(`select finish_call_follow_up('${sid}','${c.token}','accepted','SM${'4'.repeat(32)}');`)
  assert.equal(claim().eligible,false)
 })
 reset()
 await check('unknown blocks retries indefinitely including another call on same phone', () => {
  const c=claim()
  sql(`select finish_call_follow_up('${sid}','${c.token}','unknown'); update call_follow_up_claims set created_at=now()-interval '2 days';
  insert into call_logs(call_sid,caller_phone,outcome,provider_started_at) values('${sid2}','${phone}','no-answer',now()-interval '1 minute');
  insert into mcp_event_deliveries select 'event2',subscription_id,event_name,jsonb_set(payload,'{call_sid}','"${sid2}"'),status,occurred_at from mcp_event_deliveries;`)
  assert.equal(claim().eligible,false); assert.equal(claim(sid2).eligible,false)
 })
 reset()
 await check('voicemail resolves actual call and shares the same ledger', () => {
  sql(`update call_logs set outcome='voicemail',recording_url='recording'; update conversations set messages=jsonb_build_array(jsonb_build_object('role','user','metadata',jsonb_build_object('call_sid','${sid}','recording_sid','${recording}')));`)
  const c=JSON.parse(sql(`select claim_call_follow_up('${phone}',null,'${recording}');`))
  assert.equal(c.eligible,true); assert.equal(c.call_sid,sid)
  assert.equal(JSON.parse(sql(`select claim_call_follow_up('${phone}',null,'${recording}');`)).eligible,false)
 })
 reset()
 await check('malformed SID is rejected without claiming', () => {
  assert.throws(() => sql(`select claim_call_follow_up('${phone}','bad');`),/Invalid call SID/)
  assert.equal(sql('select count(*) from call_follow_up_claims;'),'0')
 })
 reset()
 await check('concurrent call claims produce exactly one sender', async () => {
  const results=await Promise.all([race(query()),race(query())])
  assert.equal(results.filter(x=>x.eligible).length,1)
 })
 reset()
 await check('concurrent calls on the same phone produce exactly one sender', async () => {
  sql(`insert into call_logs(call_sid,caller_phone,outcome,provider_started_at) values('${sid2}','${phone}','no-answer',now()-interval '1 minute');
  insert into mcp_event_deliveries select 'event2',subscription_id,event_name,jsonb_set(payload,'{call_sid}','"${sid2}"'),status,occurred_at from mcp_event_deliveries;`)
  const results=await Promise.all([race(query()),race(query(sid2))])
  assert.equal(results.filter(x=>x.eligible).length,1)
 })
 console.log(`${checks} PostgreSQL checks passed`)
} finally {
 spawnSync('docker',['rm','-f',name],{encoding:'utf8'})
}
