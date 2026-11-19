-- Run only against a disposable migrated database. All fixture writes roll back.
begin;
do $$
declare
  sid text := 'CA' || repeat('a',32);
  other_sid text := 'CA' || repeat('b',32);
  first_end timestamptz;
  transcript text;
begin
  if has_table_privilege('anon','public.phone_assistant_transcript','SELECT') or
     has_table_privilege('authenticated','public.phone_assistant_sessions','SELECT') or
     has_function_privilege('authenticated','public.phone_assistant_transcripts_for_calls(text[])','EXECUTE') then
    raise exception 'External roles can access private call records'; end if;
  insert into public.call_logs(call_sid,caller_phone) values(sid,'+13035550123');
  perform public.begin_phone_assistant_session(sid,'+13035550123',true);
  perform public.begin_phone_assistant_session(sid,'+13035550123',true);
  if not public.bind_phone_assistant_provider(sid,'provider-1') or
     not public.bind_phone_assistant_provider(sid,'provider-1') or
     public.bind_phone_assistant_provider(sid,'other') then
    raise exception 'One provider per call expected'; end if;
  perform public.begin_phone_assistant_session(other_sid,'+13035550124',false);
  if public.bind_phone_assistant_provider(other_sid,'provider-1') then raise exception 'Provider cannot bind two calls'; end if;
  if exists(select from public.call_logs where call_sid=sid and voice_assistant_answered) or
     public.mark_phone_assistant_answered(sid,'different') or
     public.finalize_phone_assistant_session(other_sid) then
    raise exception 'Unaccepted SIP call counted as answered'; end if;
  if not public.mark_phone_assistant_answered(sid,'provider-1') or not public.mark_phone_assistant_answered(sid,'provider-1') then
    raise exception 'Verified acceptance was not idempotent'; end if;
  perform public.append_phone_assistant_transcript(sid,9,'assistant','I can help.');
  perform public.append_phone_assistant_transcript(sid,3,'user','Hello');
  perform public.append_phone_assistant_transcript(sid,9,'assistant','I can help.');
  if not public.finalize_phone_assistant_session(sid) then raise exception 'Unknown voice session'; end if;
  select ended_at into first_end from public.phone_assistant_sessions where call_sid = sid;
  perform public.finalize_phone_assistant_session(sid);
  if public.bind_phone_assistant_provider(sid,'provider-1') then raise exception 'Cannot use ended call'; end if;
  perform public.append_phone_assistant_transcript(sid,12,'user','Thank you.');
  select v.transcription into transcript from public.phone_assistant_transcripts_for_calls(array[sid]) v;
  if transcript <> E'Private preview (simulated actions)\nCaller: Hello\nPhone assistant: I can help.\nCaller: Thank you.' then
    raise exception 'Unexpected ordered transcript: %',transcript; end if;
  if not exists(select from public.phone_assistant_sessions where call_sid=sid and ended_at=first_end and email_status='pending' and next_email_at>ended_at)
     or not exists(select from public.call_logs where call_sid=sid and outcome='assistant-answered')
     or (select count(*) from public.phone_assistant_transcript where call_sid=sid) <> 3 then
    raise exception 'Finalization or transcript deduplication failed'; end if;
end $$;
rollback;
