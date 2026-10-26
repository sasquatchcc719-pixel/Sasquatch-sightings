import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { setupSyntheticGapDatabase } from './gap-outreach-db-fixture.mjs'
export async function setupFirstMessageFixture(db) {
  const { owner, customer } = await setupSyntheticGapDatabase(db)
  await db.exec(`alter table ops_customers add column is_internal boolean default false;
 alter table conversations add column ops_customer_id uuid references ops_customers(id),add column source text,add column ai_enabled boolean,add column status text default 'active',add column updated_at timestamptz default now();
 alter table sms_logs add column customer_id uuid,add column message_type text,add column message_content text,add column twilio_sid text,add column sent_by text;`)
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261026200429_add_guarded_first_customer_sms.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  const preview = async () => {
    const id = randomUUID()
    await db.query(
      `insert into mcp_action_previews(id,actor_user_id,action_type,action_payload,payload_hash,preview,required_scope,idempotency_key,status,expires_at) select $1::uuid,$2::uuid,'conversation.send',jsonb_build_object('first_contact',jsonb_build_object('customer_id',id,'phone',phone,'customer_updated_at',updated_at),'body','Exact owner approved message','media_ids','[]'::jsonb),'test-hash','{}','customer:contact',($1::uuid)::text,'executing',now()+interval '10 minutes' from ops_customers where id=$3`,
      [id, owner, customer],
    )
    return id
  }
  const claim = (id, d = db) =>
    d
      .query('select claim_mcp_first_message($1,$2) x', [id, owner])
      .then((r) => r.rows[0].x)
  const finish = (id, status, sid = null, d = db) =>
    d
      .query('select finish_mcp_first_message($1,$2,$3,$4) x', [
        id,
        owner,
        status,
        sid,
      ])
      .then((r) => r.rows[0].x)
  const reset = async () => {
    await db.exec(`truncate mcp_first_message_attempts,mcp_action_audit,mcp_action_previews,conversations,sms_logs,gap_outreach_contacts,ops_sms_consent_events,blacklist cascade;
 update ops_customers set phone='+17195550100',is_internal=false;
 update mcp_authorized_users set revoked_at=null,scopes=array['business:read','customer:contact'];update sms_marketing_consents set status='opted_in';`)
  }
  return { owner, customer, preview, claim, finish, reset }
}
