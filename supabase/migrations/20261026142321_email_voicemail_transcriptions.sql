-- Preserve the immediate recording alert and durable acceptance of its later transcript.
-- The ninth argument defaults to null so existing eight-argument callbacks still work.
begin;

create or replace function public.merge_voicemail_callback(
  p_phone_number text,p_call_sid text,p_recording_sid text,p_recording_url text,
  p_duration text,p_transcription text,p_email_sent boolean default false,
  p_recording_completed boolean default false,p_transcription_email_id text default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_id uuid; v_messages jsonb; v_message jsonb; v_meta jsonb; v_index integer;
  v_duration integer; v_transcript text; v_url text; v_email_text text;
begin
  if p_phone_number !~ '^\+[1-9][0-9]{7,14}$' or p_recording_sid !~ '^RE[0-9a-fA-F]{32}$' or p_call_sid !~ '^CA[0-9a-fA-F]{32}$' then
    raise exception 'Invalid voicemail identity';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('voicemail-recording:'||p_recording_sid,0));
  perform pg_advisory_xact_lock(hashtextextended('voicemail-phone:'||p_phone_number,0));
  select c.id,c.messages::jsonb into v_id,v_messages from public.conversations c
  where c.source='inbound' and c.phone_number=p_phone_number
  order by exists(select 1 from jsonb_array_elements(coalesce(c.messages::jsonb,'[]'::jsonb)) m where m->'metadata'->>'recording_sid'=p_recording_sid) desc,c.updated_at desc
  limit 1 for update;
  if v_id is null then
    insert into public.conversations(phone_number,source,status,ai_enabled,messages,metadata)
    values(p_phone_number,'inbound','escalated',false,'[]'::jsonb,jsonb_build_object('trigger','voicemail','call_sid',p_call_sid)) returning id,messages::jsonb into v_id,v_messages;
  end if;
  v_messages:=coalesce(v_messages,'[]'::jsonb);
  select (ordinality-1)::integer,value into v_index,v_message from jsonb_array_elements(v_messages) with ordinality
  where value->'metadata'->>'recording_sid'=p_recording_sid limit 1;
  v_meta:=coalesce(v_message->'metadata','{}'::jsonb);
  v_duration:=case when p_duration ~ '^[0-9]+$' then least(p_duration::numeric,7200)::integer else 0 end;
  v_duration:=greatest(v_duration,case when v_meta->>'duration' ~ '^[0-9]+$' then least((v_meta->>'duration')::numeric,7200)::integer else 0 end);
  v_transcript:=coalesce(nullif(btrim(p_transcription),''),nullif(v_meta->>'transcription',''));
  v_url:=coalesce(nullif(p_recording_url,''),nullif(v_meta->>'recording_url',''));
  v_email_text:=coalesce(nullif(v_meta->>'transcription_email_text',''),case when lower(btrim(v_transcript)) not in ('(no transcription available)','no transcription','(none)','none') then nullif(btrim(v_transcript),'') end);
  v_meta:=v_meta||jsonb_build_object('type','voicemail','call_sid',p_call_sid,'recording_sid',p_recording_sid,'recording_url',v_url,'duration',v_duration::text,'transcription',v_transcript,'transcription_email_text',v_email_text,'transcription_email_id',coalesce(nullif(v_meta->>'transcription_email_id',''),nullif(p_transcription_email_id,'')),'email_sent',coalesce((v_meta->>'email_sent')::boolean,false) or p_email_sent,'recording_completed',coalesce((v_meta->>'recording_completed')::boolean,false) or p_recording_completed);
  v_message:=coalesce(v_message,jsonb_build_object('role','user','timestamp',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))||jsonb_build_object('content','[VOICEMAIL - '||v_duration||'s] '||coalesce(v_transcript,'(No transcription available)'),'metadata',v_meta);
  if v_index is null then v_messages:=v_messages||jsonb_build_array(v_message);
  else v_messages:=jsonb_set(v_messages,array[v_index::text],v_message); end if;
  update public.conversations set messages=v_messages,status='escalated',updated_at=now() where id=v_id;
  return jsonb_build_object('conversation_id',v_id,'messages',v_messages);
end;
$$;
revoke all on function public.merge_voicemail_callback(text,text,text,text,text,text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.merge_voicemail_callback(text,text,text,text,text,text,boolean,boolean,text) to service_role;

-- Remove the overload only after the replacement exists, in this transaction.
drop function public.merge_voicemail_callback(text,text,text,text,text,text,boolean,boolean);
notify pgrst, 'reload schema';
commit;
