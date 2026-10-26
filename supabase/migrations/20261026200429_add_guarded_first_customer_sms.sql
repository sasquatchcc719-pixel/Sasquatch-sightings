-- Owner-only first contact, without fabricating a sent conversation before provider acceptance.
create table public.mcp_first_message_attempts (
 preview_id uuid primary key references public.mcp_action_previews(id),
 actor_user_id uuid not null references auth.users(id),
 customer_id uuid not null references public.ops_customers(id),
 phone text not null,
 body text not null,
 status text not null check(status in('sending','accepted','rejected','unknown')),
 provider_sid text unique,
 conversation_id uuid references public.conversations(id),
 error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index mcp_first_message_unresolved_phone on public.mcp_first_message_attempts(phone) where status in('sending','unknown','accepted');
alter table public.mcp_first_message_attempts enable row level security;
revoke all on public.mcp_first_message_attempts from public,anon,authenticated;
grant select,insert,update on public.mcp_first_message_attempts to service_role;

create function public.claim_mcp_first_message(p_preview uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.mcp_action_previews; c public.ops_customers; prior public.mcp_first_message_attempts; target_phone text;
begin
 if not exists(select 1 from public.staff_users s join public.mcp_authorized_users g on g.user_id=s.user_id where s.user_id=p_actor and s.role='owner' and s.is_active and g.revoked_at is null and g.scopes @> array['business:read','customer:contact']) then raise exception 'Active owner contact grant required'; end if;
 select * into a from public.mcp_action_previews where id=p_preview and actor_user_id=p_actor for update;
 if not found or a.action_type<>'conversation.send' or a.status<>'executing' or a.expires_at<=now() or a.action_payload->'first_contact' is null then raise exception 'Executing unexpired first-contact preview required'; end if;
 select * into c from public.ops_customers where id=(a.action_payload->'first_contact'->>'customer_id')::uuid for update;
 if not found then raise exception 'Customer not found'; end if;
 target_phone:=public.gap_outreach_phone(c.phone);
 if target_phone is null or length(target_phone)<>12 or target_phone<>a.action_payload->'first_contact'->>'phone' or c.updated_at is null or c.updated_at is distinct from (a.action_payload->'first_contact'->>'customer_updated_at')::timestamptz or coalesce(c.is_internal,false) then raise exception 'Customer identity changed or not contactable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(target_phone,0));
 select * into prior from public.mcp_first_message_attempts where mcp_first_message_attempts.phone=target_phone and (status<>'rejected' or preview_id=p_preview) order by created_at desc limit 1;
 if found then return jsonb_build_object('claimed',false,'status',prior.status,'preview_id',prior.preview_id,'provider_sid',prior.provider_sid,'conversation_id',prior.conversation_id); end if;
 if exists(select 1 from public.ops_customers x where x.id<>c.id and public.gap_outreach_phone(x.phone)=target_phone) then raise exception 'Ambiguous customer phone'; end if;
 if exists(select 1 from public.blacklist b where public.gap_outreach_phone(b.phone)=target_phone)
 or exists(select 1 from public.sms_marketing_consents s where (s.customer_id=c.id or public.gap_outreach_phone(s.phone_normalized)=target_phone) and s.status='opted_out')
 or exists(select 1 from public.ops_sms_consent_events e where (e.customer_id=c.id or public.gap_outreach_phone(e.phone)=target_phone) and e.action='opted_out') then raise exception 'Customer contact suppressed'; end if;
 if exists(select 1 from public.conversations t where t.ops_customer_id=c.id or public.gap_outreach_phone(t.phone_number)=target_phone) then raise exception 'Conversation appeared after preview; inspect it before contacting'; end if;
 if coalesce(length(a.action_payload->>'body'),0) not between 1 and 1600 or jsonb_array_length(coalesce(a.action_payload->'media_ids','[]'))<>0 then raise exception 'First contact requires exact text only'; end if;
 insert into public.mcp_first_message_attempts(preview_id,actor_user_id,customer_id,phone,body,status) values(a.id,p_actor,c.id,target_phone,a.action_payload->>'body','sending');
 return jsonb_build_object('claimed',true,'phone',target_phone,'customer_id',c.id,'body',a.action_payload->>'body');
end $$;

create function public.finish_mcp_first_message(p_preview uuid,p_actor uuid,p_status text,p_sid text default null,p_error text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.mcp_first_message_attempts; convo public.conversations; message jsonb;
begin
 select * into r from public.mcp_first_message_attempts where preview_id=p_preview and actor_user_id=p_actor for update;
 if not found then raise exception 'Claimed owner message required'; end if;
 if r.status='accepted' then
   if p_sid is distinct from r.provider_sid then raise exception 'Provider SID mismatch'; end if;
   return jsonb_build_object('status',r.status,'twilio_sid',r.provider_sid,'conversation_id',r.conversation_id,'history_recorded',true);
 end if;
 if p_status not in('accepted','rejected','unknown') then raise exception 'Invalid provider outcome'; end if;
 if p_status='accepted' then
   if p_sid is null or p_sid !~ '^SM[0-9a-fA-F]{32}$' then raise exception 'Provider SID required'; end if;
   perform pg_advisory_xact_lock(hashtextextended(r.phone,0));
   select * into convo from public.conversations where ops_customer_id=r.customer_id or public.gap_outreach_phone(phone_number)=r.phone order by updated_at desc limit 1 for update;
   if found and (public.gap_outreach_phone(convo.phone_number)<>r.phone or (convo.ops_customer_id is not null and convo.ops_customer_id<>r.customer_id)) then raise exception 'Conversation identity mismatch; reconcile accepted send'; end if;
   if not found then
     insert into public.conversations(phone_number,ops_customer_id,source,messages,ai_enabled,status) values(r.phone,r.customer_id,'admin_outbound','[]',false,'active') returning * into convo;
   end if;
   message:=jsonb_build_object('role','assistant','content',r.body,'timestamp',now(),'twilio_sid',p_sid,'sent_by','Owner-approved Sightings first contact');
   if not exists(select 1 from jsonb_array_elements(coalesce(convo.messages,'[]')) m where m->>'twilio_sid'=p_sid) then
     update public.conversations set messages=coalesce(messages,'[]')||jsonb_build_array(message),ops_customer_id=r.customer_id,updated_at=now() where id=convo.id;
   end if;
   if not exists(select 1 from public.sms_logs where twilio_sid=p_sid) then
     insert into public.sms_logs(customer_id,recipient_phone,message_type,message_content,twilio_sid,status,sent_by) values(r.customer_id,r.phone,'admin_outbound',r.body,p_sid,'sent','Owner-approved Sightings first contact');
   end if;
 end if;
 update public.mcp_first_message_attempts set status=p_status,provider_sid=p_sid,conversation_id=case when p_status='accepted' then convo.id else conversation_id end,error_code=left(p_error,200),updated_at=now() where preview_id=r.preview_id;
 return jsonb_build_object('status',p_status,'twilio_sid',p_sid,'conversation_id',case when p_status='accepted' then convo.id else null end,'history_recorded',p_status='accepted');
end $$;
revoke all on function public.claim_mcp_first_message(uuid,uuid),public.finish_mcp_first_message(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_mcp_first_message(uuid,uuid),public.finish_mcp_first_message(uuid,uuid,text,text,text) to service_role;
