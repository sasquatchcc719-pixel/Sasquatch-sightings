begin;

-- Add genuine call events without replacing or changing the existing SMS watch.
alter table public.mcp_event_subscriptions drop constraint mcp_event_subscriptions_event_name_check;
alter table public.mcp_event_subscriptions add constraint mcp_event_subscriptions_event_name_check
  check (event_name in ('conversation.message.received', 'call.missed'));
alter table public.mcp_event_deliveries drop constraint mcp_event_deliveries_event_name_check;
alter table public.mcp_event_deliveries add constraint mcp_event_deliveries_event_name_check
  check (event_name in ('conversation.message.received', 'call.missed'));

-- A call is already a real contact event. Keep its conversation empty until a
-- real SMS/voicemail arrives; never manufacture an inbound message to wake dot.
create function public.ensure_missed_call_conversation(p_call_sid text)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_call public.call_logs%rowtype;
  v_conversation_id uuid;
  v_customer_id uuid;
begin
  if p_call_sid is null or p_call_sid !~ '^CA[0-9a-fA-F]{32}$' then return null; end if;
  select * into v_call from public.call_logs where call_sid=p_call_sid;
  if not found or v_call.direction is distinct from 'inbound' or v_call.outcome is distinct from 'no-answer'
     or v_call.caller_phone is null or v_call.caller_phone !~ '^\+[1-9][0-9]{7,14}$'
     or v_call.recording_url is not null or v_call.transcription is not null
     or v_call.forwarding_accepted_at is not null
     or v_call.created_at is null or v_call.created_at < now()-interval '1 day'
     or not exists (
       select 1 from public.mcp_event_subscriptions s where s.event_name='call.missed'
       and s.status='active' and s.created_at<=v_call.created_at
       and (s.expires_at is null or s.expires_at>now())
     ) then return null; end if;
  if public.is_phone_blacklisted(v_call.caller_phone) then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('missed-call-context:'||v_call.caller_phone,0));
  select id into v_conversation_id from public.conversations
    where phone_number=v_call.caller_phone order by updated_at desc nulls last,id limit 1;
  if v_conversation_id is not null then return v_conversation_id; end if;
  -- Link a known customer only when that phone uniquely identifies one.
  select case when count(*)=1 then (array_agg(id))[1] else null end into v_customer_id
    from public.ops_customers
    where regexp_replace(coalesce(phone,''),'[^0-9]','','g') in (
      regexp_replace(v_call.caller_phone,'[^0-9]','','g'),
      right(regexp_replace(v_call.caller_phone,'[^0-9]','','g'),10)
    );
  insert into public.conversations(phone_number,source,status,messages,ops_customer_id,metadata)
    values(v_call.caller_phone,'inbound','active','[]'::jsonb,v_customer_id,
      jsonb_build_object('trigger','missed_call','call_sid',p_call_sid))
    returning id into v_conversation_id;
  return v_conversation_id;
end;
$$;
revoke all on function public.ensure_missed_call_conversation(text) from public,anon,authenticated;
grant execute on function public.ensure_missed_call_conversation(text) to service_role;
notify pgrst,'reload schema';
commit;
