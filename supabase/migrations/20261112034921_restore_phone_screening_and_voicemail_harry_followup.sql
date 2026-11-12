begin;

-- One durable claim per voicemail prevents Twilio callback retries from
-- generating or sending a second Harry follow-up.
create unique index if not exists idx_sms_logs_unique_voicemail_harry_reply
  on public.sms_logs (message_type)
  where message_type like 'voicemail_harry_reply:%';

create function public.claim_voicemail_harry_follow_up(
  p_recording_sid text,
  p_phone text,
  p_transcript text
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_message_type text;
begin
  if p_recording_sid !~ '^RE[0-9a-fA-F]{32}$'
    or p_phone !~ '^\+[1-9][0-9]{7,14}$'
    or nullif(btrim(p_transcript), '') is null then
    raise exception 'Invalid voicemail follow-up claim';
  end if;

  v_message_type := 'voicemail_harry_reply:' || p_recording_sid;
  insert into public.sms_logs (
    recipient_phone,
    message_type,
    message_content,
    status,
    sent_at
  ) values (
    p_phone,
    v_message_type,
    p_transcript,
    'generating',
    now()
  )
  on conflict (message_type)
    where message_type like 'voicemail_harry_reply:%'
  do update set
    recipient_phone = excluded.recipient_phone,
    message_content = excluded.message_content,
    status = 'generating',
    twilio_sid = null,
    sent_at = now()
  where public.sms_logs.status = 'failed'
    or (
      public.sms_logs.status = 'generating'
      and public.sms_logs.sent_at < now() - interval '5 minutes'
    )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.claim_voicemail_harry_follow_up(text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_voicemail_harry_follow_up(text, text, text)
  to service_role;

create function public.record_voicemail_harry_reply(
  p_phone text,
  p_recording_sid text,
  p_twilio_sid text,
  p_body text
) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_conversation_id uuid;
  v_messages jsonb;
begin
  if p_phone !~ '^\+[1-9][0-9]{7,14}$'
    or p_recording_sid !~ '^RE[0-9a-fA-F]{32}$'
    or p_twilio_sid !~ '^SM[0-9a-fA-F]{32}$'
    or nullif(btrim(p_body), '') is null then
    raise exception 'Invalid voicemail Harry reply';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('voicemail-recording:' || p_recording_sid, 0)
  );

  select c.id, coalesce(c.messages::jsonb, '[]'::jsonb)
    into v_conversation_id, v_messages
  from public.conversations c
  where c.source = 'inbound'
    and c.phone_number = p_phone
    and exists (
      select 1
      from jsonb_array_elements(coalesce(c.messages::jsonb, '[]'::jsonb)) message
      where message->'metadata'->>'recording_sid' = p_recording_sid
    )
  order by c.updated_at desc
  limit 1
  for update;

  if v_conversation_id is null then
    raise exception 'Voicemail conversation not found';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_messages) message
    where message->'metadata'->>'voicemail_harry_reply_for' = p_recording_sid
  ) then
    return false;
  end if;

  v_messages := v_messages || jsonb_build_array(
    jsonb_build_object(
      'role', 'assistant',
      'content', btrim(p_body),
      'timestamp', to_char(
        clock_timestamp() at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'twilio_sid', p_twilio_sid,
      'metadata', jsonb_build_object(
        'type', 'voicemail_harry_reply',
        'voicemail_harry_reply_for', p_recording_sid
      )
    )
  );

  update public.conversations
  set messages = v_messages,
      updated_at = now()
  where id = v_conversation_id;

  return true;
end;
$$;

revoke all on function public.record_voicemail_harry_reply(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_voicemail_harry_reply(text, text, text, text)
  to service_role;

notify pgrst, 'reload schema';
commit;
