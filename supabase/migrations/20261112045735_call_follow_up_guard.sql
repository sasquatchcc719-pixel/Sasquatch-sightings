begin;

alter table public.call_logs add column if not exists provider_started_at timestamptz;

-- Deployment-time boundary is immutable: historical calls never become eligible.
create table public.call_follow_up_settings (
  singleton boolean primary key default true check (singleton),
  activated_at timestamptz not null default clock_timestamp()
);
insert into public.call_follow_up_settings(singleton) values(true);
create table public.call_follow_up_claims (
  call_sid text primary key references public.call_logs(call_sid),
  idempotency_key text not null unique,
  phone text not null,
  token uuid not null default gen_random_uuid(),
  status text not null check(status in ('sending','accepted','unknown','rejected','suppressed','skipped')),
  twilio_sid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.call_follow_up_settings enable row level security;
alter table public.call_follow_up_claims enable row level security;
revoke all on public.call_follow_up_settings, public.call_follow_up_claims from public, anon, authenticated;
grant select on public.call_follow_up_settings to service_role;
grant select,insert,update on public.call_follow_up_claims to service_role;

create function public.claim_call_follow_up(p_phone text, p_call_sid text default null,
 p_recording_sid text default null, p_preview_only boolean default false, p_conversation_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.call_logs; sid text; mappings integer; claim public.call_follow_up_claims;
begin
 if p_phone is null or p_phone !~ '^\+1[0-9]{10}$' then raise exception 'Invalid phone'; end if;
 if not exists(select 1 from public.call_follow_up_settings where singleton) then
  return jsonb_build_object('eligible',false,'reason','activation_missing');
 end if;
 if p_recording_sid is not null then
  if p_recording_sid !~ '^RE[0-9a-fA-F]{32}$' or p_call_sid is not null then raise exception 'Invalid recording claim'; end if;
  select count(distinct m->'metadata'->>'call_sid'), min(m->'metadata'->>'call_sid') into mappings,sid
  from public.conversations v cross join lateral jsonb_array_elements(coalesce(v.messages::jsonb,'[]'::jsonb)) m
  where public.gap_outreach_phone(v.phone_number)=p_phone and m->'metadata'->>'recording_sid'=p_recording_sid;
  if mappings<>1 then return jsonb_build_object('eligible',false,'reason','recording_mapping_uncertain'); end if;
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
  if not exists(select 1 from public.mcp_event_deliveries e join public.mcp_event_subscriptions sub on sub.id=e.subscription_id
    where e.event_name='call.missed' and sub.event_name='call.missed' and sub.status='active' and sub.created_at<=e.occurred_at
    and (sub.expires_at is null or sub.expires_at>now())
    and e.payload->>'conversation_id'=p_conversation_id::text
    and exists(select 1 from public.conversations v where v.id=p_conversation_id and public.gap_outreach_phone(v.phone_number)=p_phone)
    and e.payload->>'call_sid'=sid and e.status<>'discarded'
    and e.occurred_at >= (select activated_at from public.call_follow_up_settings where singleton)
    and e.occurred_at >= now()-interval '24 hours') then
   return jsonb_build_object('eligible',false,'reason','future_event_required');
  end if;
 elsif c.outcome<>'voicemail' or nullif(c.recording_url,'') is null then
  return jsonb_build_object('eligible',false,'reason','voicemail_not_final');
 end if;
 if public.is_phone_blacklisted(right(p_phone,10)) is distinct from false
 or exists(select 1 from public.sms_marketing_consents where public.gap_outreach_phone(phone_normalized)=p_phone and status='opted_out')
 or exists(select 1 from public.ops_sms_consent_events where public.gap_outreach_phone(phone)=p_phone and action='opted_out')
 or exists(select 1 from public.conversations v
   where public.gap_outreach_phone(v.phone_number)=p_phone and v.ai_enabled is distinct from true) then
  return jsonb_build_object('eligible',false,'reason','suppressed_or_owner_takeover');
 end if;
 if exists(select 1 from public.mcp_first_message_attempts where phone=p_phone and status in ('sending','unknown'))
 or exists(select 1 from public.sms_logs where public.gap_outreach_phone(recipient_phone)=p_phone
   and coalesce(sent_at,created_at)>=c.provider_started_at
   and coalesce(message_type,'') not in ('voicemail_received','inbound_sms','sms_received')
   and coalesce(status,'unknown') not in ('received','failed','rejected','suppressed','skipped'))
 or exists(select 1 from public.conversations v cross join lateral jsonb_array_elements(coalesce(v.messages::jsonb,'[]'::jsonb)) m
   where public.gap_outreach_phone(v.phone_number)=p_phone and m->>'role'='assistant'
   and (m->>'timestamp')::timestamptz>=c.provider_started_at)
 or exists(select 1 from public.call_follow_up_claims where call_sid=sid or (phone=p_phone and status in ('sending','unknown'))) then
  return jsonb_build_object('eligible',false,'reason','already_handled_or_uncertain');
 end if;
 if p_preview_only then return jsonb_build_object('eligible',true,'call_sid',sid); end if;
 insert into public.call_follow_up_claims(call_sid,idempotency_key,phone,status)
 values(sid,'missed-call:'||sid||':v1',p_phone,'sending') returning * into claim;
 return jsonb_build_object('eligible',true,'call_sid',sid,'token',claim.token);
end $$;

create function public.finish_call_follow_up(p_call_sid text,p_token uuid,p_status text,p_twilio_sid text default null)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if p_status not in ('accepted','unknown','rejected','suppressed','skipped')
 or (p_status='accepted' and coalesce(p_twilio_sid,'') !~ '^SM[0-9a-fA-F]{32}$') then raise exception 'Invalid outcome'; end if;
 update public.call_follow_up_claims set status=p_status,twilio_sid=p_twilio_sid,updated_at=now()
 where call_sid=p_call_sid and token=p_token and status='sending';
 if not found then raise exception 'Call claim cannot be finalized; reconcile without resending'; end if;
end $$;
revoke all on function public.claim_call_follow_up(text,text,text,boolean,uuid),public.finish_call_follow_up(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_call_follow_up(text,text,text,boolean,uuid),public.finish_call_follow_up(text,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
