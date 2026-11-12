begin;

-- A separate deployment-time boundary keeps the owner-email wake-up bridge
-- future-only even when Twilio replays a valid old terminal callback.
create table public.missed_call_bridge_settings (
  singleton boolean primary key default true check (singleton),
  activated_at timestamptz not null default clock_timestamp()
);
insert into public.missed_call_bridge_settings(singleton) values(true);

create table public.missed_call_email_notifications (
  call_sid text primary key references public.call_logs(call_sid),
  conversation_id uuid not null references public.conversations(id),
  occurred_at timestamptz not null,
  finalized_at timestamptz not null,
  available_at timestamptz not null,
  sender text not null,
  recipient text not null,
  subject text not null,
  body_text text not null,
  status text not null default 'pending'
    check (status in ('pending','sending','accepted','unknown','rejected','suppressed')),
  claim_token uuid,
  attempts integer not null default 0 check (attempts >= 0),
  provider_id text,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  accepted_at timestamptz,
  check (call_sid ~ '^CA[0-9a-fA-F]{32}$'),
  check (finalized_at >= occurred_at)
);
create index missed_call_email_notifications_pending_idx
  on public.missed_call_email_notifications(status, available_at)
  where status='pending';

alter table public.missed_call_bridge_settings enable row level security;
alter table public.missed_call_email_notifications enable row level security;
revoke all on public.missed_call_bridge_settings, public.missed_call_email_notifications
  from public, anon, authenticated;
grant select on public.missed_call_bridge_settings to service_role;
grant select,insert,update on public.missed_call_email_notifications to service_role;

comment on table public.missed_call_bridge_settings is
  'Immutable application activation boundary for future-only missed-call owner emails.';
comment on table public.missed_call_email_notifications is
  'One provider-idempotent owner wake-up email per verified future missed CallSid; never a customer message.';

-- Create or reuse real call context without manufacturing an inbound message.
-- This bridge is independent of the native MCP event subscription catalog.
create function public.ensure_missed_call_bridge_conversation(p_call_sid text)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_call public.call_logs%rowtype;
  v_conversation_id uuid;
  v_customer_id uuid;
  v_activated_at timestamptz;
begin
  if p_call_sid is null or p_call_sid !~ '^CA[0-9a-fA-F]{32}$' then return null; end if;
  select activated_at into v_activated_at from public.missed_call_bridge_settings where singleton;
  if v_activated_at is null then return null; end if;
  select * into v_call from public.call_logs where call_sid=p_call_sid;
  if not found or v_call.direction is distinct from 'inbound'
     or v_call.outcome is distinct from 'no-answer'
     or v_call.caller_phone is null or v_call.caller_phone !~ '^\+[1-9][0-9]{7,14}$'
     or v_call.provider_started_at is null or v_call.provider_started_at<v_activated_at
     or v_call.provider_started_at<now()-interval '1 day' or v_call.provider_started_at>now()
     or v_call.recording_url is not null or v_call.transcription is not null
     or v_call.forwarding_accepted_at is not null then return null; end if;
  if public.is_phone_blacklisted(v_call.caller_phone) then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('missed-call-context:'||v_call.caller_phone,0));
  select id into v_conversation_id from public.conversations
    where public.gap_outreach_phone(phone_number)=public.gap_outreach_phone(v_call.caller_phone)
    order by updated_at desc nulls last,id limit 1;
  if v_conversation_id is not null then return v_conversation_id; end if;
  select case when count(*)=1 then (array_agg(id))[1] else null end into v_customer_id
    from public.ops_customers
    where public.gap_outreach_phone(phone)=public.gap_outreach_phone(v_call.caller_phone);
  insert into public.conversations(phone_number,source,status,messages,ops_customer_id,metadata)
    values(v_call.caller_phone,'inbound','active','[]'::jsonb,v_customer_id,
      jsonb_build_object('trigger','missed_call','call_sid',p_call_sid))
    returning id into v_conversation_id;
  return v_conversation_id;
end;
$$;

-- Claim only a still-current missed call after the same voicemail-settling
-- delay. Any provider attempt is terminal for automatic processing.
create function public.claim_missed_call_email_notification(p_call_sid text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  n public.missed_call_email_notifications;
  c public.call_logs;
  v_activated_at timestamptz;
  v_phone text;
  v_lock_phone text;
  v_customer_id uuid;
  v_customer_matches integer;
begin
  if p_call_sid is null or p_call_sid !~ '^CA[0-9a-fA-F]{32}$' then
    raise exception 'Invalid call SID';
  end if;
  select public.gap_outreach_phone(caller_phone) into v_lock_phone
    from public.call_logs where call_sid=p_call_sid;
  if v_lock_phone is null then return jsonb_build_object('eligible',false,'reason','call_missing'); end if;
  -- Match the shared customer-send lock order: phone, CallSid, then the
  -- bridge-specific row. This prevents a voicemail/customer claim deadlock.
  perform pg_advisory_xact_lock(hashtextextended(v_lock_phone,0));
  perform pg_advisory_xact_lock(hashtextextended('call-follow-up:'||p_call_sid,0));
  perform pg_advisory_xact_lock(hashtextextended('missed-call-email:'||p_call_sid,0));
  select * into n from public.missed_call_email_notifications where call_sid=p_call_sid for update;
  if not found or n.status<>'pending' then
    return jsonb_build_object('eligible',false,'reason','not_pending');
  end if;
  if n.available_at>now() then
    return jsonb_build_object('eligible',false,'reason','settling');
  end if;
  select activated_at into v_activated_at from public.missed_call_bridge_settings where singleton;
  select * into c from public.call_logs where call_sid=p_call_sid for update;
  select ops_customer_id into v_customer_id from public.conversations where id=n.conversation_id;
  v_phone:=public.gap_outreach_phone(c.caller_phone);
  if v_phone is distinct from v_lock_phone then
    return jsonb_build_object('eligible',false,'reason','call_phone_changed');
  end if;
  if v_activated_at is null or c.call_sid is null or c.provider_started_at is null
     or c.provider_started_at<v_activated_at or c.provider_started_at<now()-interval '1 day'
     or c.provider_started_at>now() or c.direction<>'inbound'
     or c.outcome<>'no-answer' or c.forwarding_accepted_at is not null
     or nullif(c.recording_url,'') is not null or nullif(c.transcription,'') is not null
     or v_phone is null
     or not exists(select 1 from public.conversations v where v.id=n.conversation_id
       and public.gap_outreach_phone(v.phone_number)=v_phone) then
    update public.missed_call_email_notifications set status='suppressed',
      last_error='call_no_longer_missed',updated_at=clock_timestamp() where call_sid=p_call_sid;
    return jsonb_build_object('eligible',false,'reason','call_no_longer_missed');
  end if;
  if v_customer_id is null then
    select count(*),case when count(*)=1 then (array_agg(id))[1] else null end
      into v_customer_matches,v_customer_id from public.ops_customers
      where public.gap_outreach_phone(phone)=v_phone;
    if v_customer_matches>1 then
      update public.missed_call_email_notifications set status='suppressed',
        last_error='customer_identity_ambiguous',updated_at=clock_timestamp() where call_sid=p_call_sid;
      return jsonb_build_object('eligible',false,'reason','customer_identity_ambiguous');
    end if;
  end if;
  if public.is_phone_blacklisted(right(v_phone,10)) is distinct from false
     or exists(select 1 from public.sms_marketing_consents where public.gap_outreach_phone(phone_normalized)=v_phone and status='opted_out')
     or exists(select 1 from public.ops_sms_consent_events where public.gap_outreach_phone(phone)=v_phone and action='opted_out')
     or exists(select 1 from public.conversations v where public.gap_outreach_phone(v.phone_number)=v_phone and v.ai_enabled is distinct from true)
     or exists(select 1 from public.mcp_first_message_attempts where phone=v_phone and status in ('sending','unknown'))
     or exists(select 1 from public.sms_logs where public.gap_outreach_phone(recipient_phone)=v_phone
       and coalesce(sent_at,created_at)>=c.provider_started_at
       and coalesce(message_type,'') not in ('voicemail_received','inbound_sms','sms_received')
       and coalesce(status,'unknown') not in ('received','failed','rejected','suppressed','skipped'))
     or exists(select 1 from public.conversations v cross join lateral jsonb_array_elements(coalesce(v.messages::jsonb,'[]'::jsonb)) m
       where public.gap_outreach_phone(v.phone_number)=v_phone and m->>'role'='assistant'
       and (m->>'timestamp')::timestamptz>=c.provider_started_at)
     or (v_customer_id is not null and exists(select 1 from public.ops_customer_email_history e
       where e.customer_id=v_customer_id and e.direction='outbound' and e.occurred_at>=c.provider_started_at))
     or (v_customer_id is not null and exists(select 1 from public.ops_email_log e
       where e.customer_id=v_customer_id and e.status='sent' and e.sent_at>=c.provider_started_at))
     or exists(select 1 from public.call_follow_up_claims f where f.call_sid=p_call_sid
       or (f.phone=v_phone and f.status in ('sending','unknown'))) then
    update public.missed_call_email_notifications set status='suppressed',
      last_error='suppressed_or_already_handled',updated_at=clock_timestamp() where call_sid=p_call_sid;
    return jsonb_build_object('eligible',false,'reason','suppressed_or_already_handled');
  end if;
  update public.missed_call_email_notifications set status='sending',
    claim_token=gen_random_uuid(),attempts=attempts+1,updated_at=clock_timestamp(),last_error=null
    where call_sid=p_call_sid returning * into n;
  return jsonb_build_object('eligible',true,'call_sid',n.call_sid,'token',n.claim_token,
    'conversation_id',n.conversation_id,'occurred_at',n.occurred_at,'finalized_at',n.finalized_at,
    'sender',n.sender,'recipient',n.recipient,'subject',n.subject,'body_text',n.body_text);
end;
$$;

create function public.finish_missed_call_email_notification(
  p_call_sid text,p_token uuid,p_status text,p_provider_id text default null,p_error text default null)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if p_status not in ('accepted','unknown','rejected')
     or (p_status='accepted' and coalesce(p_provider_id,'')='') then
    raise exception 'Invalid email outcome';
  end if;
  update public.missed_call_email_notifications set status=p_status,
    provider_id=p_provider_id,last_error=left(p_error,1000),updated_at=clock_timestamp(),
    accepted_at=case when p_status='accepted' then clock_timestamp() else accepted_at end
    where call_sid=p_call_sid and claim_token=p_token and status='sending';
  if not found then raise exception 'Email claim cannot be finalized; do not resend'; end if;
end;
$$;

-- Reissue the shared customer-contact guard. Genuine native delivery evidence
-- or an accepted bridge notice can authorize the same CallSid-bound preview;
-- neither the Gmail body nor an arbitrary caller-supplied ID is trusted.
create or replace function public.claim_call_follow_up(p_phone text, p_call_sid text default null,
 p_recording_sid text default null, p_preview_only boolean default false, p_conversation_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.call_logs; sid text; mappings integer; conversation_mappings integer;
 claim public.call_follow_up_claims; v_customer_id uuid; v_customer_matches integer;
 v_recording_conversation_id uuid;
begin
 if p_phone is null or p_phone !~ '^\+1[0-9]{10}$' then raise exception 'Invalid phone'; end if;
 if not exists(select 1 from public.call_follow_up_settings where singleton) then
  return jsonb_build_object('eligible',false,'reason','activation_missing');
 end if;
 if p_recording_sid is not null then
  if p_recording_sid !~ '^RE[0-9a-fA-F]{32}$' or p_call_sid is not null then raise exception 'Invalid recording claim'; end if;
  select count(distinct m->'metadata'->>'call_sid'), min(m->'metadata'->>'call_sid'),
    count(distinct v.id),min(v.id::text)::uuid
    into mappings,sid,conversation_mappings,v_recording_conversation_id
  from public.conversations v cross join lateral jsonb_array_elements(coalesce(v.messages::jsonb,'[]'::jsonb)) m
  where public.gap_outreach_phone(v.phone_number)=p_phone and m->'metadata'->>'recording_sid'=p_recording_sid;
  if mappings<>1 or conversation_mappings<>1 then return jsonb_build_object('eligible',false,'reason','recording_mapping_uncertain'); end if;
 else sid:=p_call_sid;
 end if;
 if sid is null or sid !~ '^CA[0-9a-fA-F]{32}$' then raise exception 'Invalid call SID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_phone,0));
 perform pg_advisory_xact_lock(hashtextextended('call-follow-up:'||sid,0));
 select * into c from public.call_logs where call_sid=sid for update;
 if not found or c.provider_started_at is null or c.provider_started_at < (select activated_at from public.call_follow_up_settings where singleton)
 or c.provider_started_at < now()-interval '24 hours' or c.provider_started_at>now()
 or c.direction<>'inbound' or public.gap_outreach_phone(c.caller_phone) is distinct from p_phone
 or c.forwarding_accepted_at is not null or c.outcome in ('answered','blacklisted') then
  return jsonb_build_object('eligible',false,'reason','call_not_eligible');
 end if;
 if p_recording_sid is null then
  if c.outcome<>'no-answer' or nullif(c.recording_url,'') is not null or nullif(c.transcription,'') is not null then
   return jsonb_build_object('eligible',false,'reason','not_final_missed');
  end if;
  if not (
    exists(select 1 from public.mcp_event_deliveries e join public.mcp_event_subscriptions sub on sub.id=e.subscription_id
      where e.event_name='call.missed' and sub.event_name='call.missed' and sub.status='active' and sub.created_at<=e.occurred_at
      and (sub.expires_at is null or sub.expires_at>now())
      and e.payload->>'conversation_id'=p_conversation_id::text
      and exists(select 1 from public.conversations v where v.id=p_conversation_id and public.gap_outreach_phone(v.phone_number)=p_phone)
      and e.payload->>'call_sid'=sid and e.status<>'discarded'
      and e.occurred_at >= (select activated_at from public.call_follow_up_settings where singleton)
      and e.occurred_at >= now()-interval '24 hours')
    or exists(select 1 from public.missed_call_email_notifications n
      join public.missed_call_bridge_settings s on s.singleton
      where n.call_sid=sid and n.conversation_id=p_conversation_id and n.status='accepted'
      and nullif(n.provider_id,'') is not null and n.occurred_at>=s.activated_at
      and n.occurred_at>=now()-interval '24 hours'
      and exists(select 1 from public.conversations v where v.id=p_conversation_id and public.gap_outreach_phone(v.phone_number)=p_phone))
  ) then
   return jsonb_build_object('eligible',false,'reason','future_event_or_notice_required');
  end if;
 elsif c.outcome<>'voicemail' or nullif(c.recording_url,'') is null then
  return jsonb_build_object('eligible',false,'reason','voicemail_not_final');
 end if;
 select ops_customer_id into v_customer_id from public.conversations
   where id=coalesce(p_conversation_id,v_recording_conversation_id);
 if v_customer_id is null then
  select count(*),case when count(*)=1 then (array_agg(id))[1] else null end
    into v_customer_matches,v_customer_id from public.ops_customers
    where public.gap_outreach_phone(phone)=p_phone;
  if v_customer_matches>1 then
   return jsonb_build_object('eligible',false,'reason','customer_identity_ambiguous');
  end if;
 end if;
 if public.is_phone_blacklisted(right(p_phone,10)) is distinct from false
 or exists(select 1 from public.sms_marketing_consents where public.gap_outreach_phone(phone_normalized)=p_phone and status='opted_out')
 or exists(select 1 from public.ops_sms_consent_events where public.gap_outreach_phone(phone)=p_phone and action='opted_out')
 or exists(select 1 from public.conversations v where public.gap_outreach_phone(v.phone_number)=p_phone and v.ai_enabled is distinct from true)
 or exists(select 1 from public.mcp_first_message_attempts where phone=p_phone and status in ('sending','unknown'))
 or exists(select 1 from public.sms_logs where public.gap_outreach_phone(recipient_phone)=p_phone
   and coalesce(sent_at,created_at)>=c.provider_started_at
   and coalesce(message_type,'') not in ('voicemail_received','inbound_sms','sms_received')
   and coalesce(status,'unknown') not in ('received','failed','rejected','suppressed','skipped'))
 or exists(select 1 from public.conversations v cross join lateral jsonb_array_elements(coalesce(v.messages::jsonb,'[]'::jsonb)) m
   where public.gap_outreach_phone(v.phone_number)=p_phone and m->>'role'='assistant'
   and (m->>'timestamp')::timestamptz>=c.provider_started_at)
 or (v_customer_id is not null and exists(select 1 from public.ops_customer_email_history e
   where e.customer_id=v_customer_id and e.direction='outbound' and e.occurred_at>=c.provider_started_at))
 or (v_customer_id is not null and exists(select 1 from public.ops_email_log e
   where e.customer_id=v_customer_id and e.status='sent' and e.sent_at>=c.provider_started_at))
 or exists(select 1 from public.call_follow_up_claims where call_sid=sid or (phone=p_phone and status in ('sending','unknown'))) then
  return jsonb_build_object('eligible',false,'reason','already_handled_or_uncertain');
 end if;
 if p_preview_only then return jsonb_build_object('eligible',true,'call_sid',sid); end if;
 insert into public.call_follow_up_claims(call_sid,idempotency_key,phone,status)
 values(sid,'missed-call:'||sid||':v1',p_phone,'sending') returning * into claim;
 return jsonb_build_object('eligible',true,'call_sid',sid,'token',claim.token);
end $$;

revoke all on function public.ensure_missed_call_bridge_conversation(text),
 public.claim_missed_call_email_notification(text),
 public.finish_missed_call_email_notification(text,uuid,text,text,text)
 from public,anon,authenticated;
grant execute on function public.ensure_missed_call_bridge_conversation(text),
 public.claim_missed_call_email_notification(text),
 public.finish_missed_call_email_notification(text,uuid,text,text,text)
 to service_role;
notify pgrst,'reload schema';
commit;
