-- The browser cannot access callers' transcripts or the email delivery state.
alter table public.call_logs
  add column voice_preview boolean not null default false,
  add column voice_assistant_answered boolean not null default false;

create table public.phone_assistant_sessions (
  call_sid text primary key check (call_sid ~ '^CA[0-9a-fA-F]{32}$'),
  caller_phone text not null,
  provider_call_id text unique,
  pilot boolean not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  answered_at timestamptz,
  summary text,
  email_status text not null default 'waiting' check (email_status in ('waiting','pending','sent','review')),
  next_email_at timestamptz,
  first_email_attempt_at timestamptz,
  email_payload jsonb,
  email_id text
);
create table public.phone_assistant_transcript (
  call_sid text not null references public.phone_assistant_sessions(call_sid) on delete cascade,
  sequence integer not null check (sequence >= 0),
  role text not null check (role in ('user','assistant')),
  content text not null,
  primary key(call_sid,sequence)
);
alter table public.phone_assistant_sessions enable row level security;
alter table public.phone_assistant_transcript enable row level security;
revoke all on public.phone_assistant_sessions, public.phone_assistant_transcript from public, anon, authenticated;
grant select, insert, update on public.phone_assistant_sessions to service_role;
grant select, insert on public.phone_assistant_transcript to service_role;
create index phone_assistant_started on public.phone_assistant_sessions (started_at desc);
create index phone_assistant_email_due on public.phone_assistant_sessions (next_email_at) where email_status = 'pending';

create function public.begin_phone_assistant_session(p_sid text, p_phone text, p_pilot boolean)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.phone_assistant_sessions(call_sid, caller_phone, pilot)
    values(p_sid, p_phone, p_pilot) on conflict(call_sid) do nothing;
  if not exists(select from public.phone_assistant_sessions where call_sid = p_sid and caller_phone = p_phone and pilot = p_pilot) then
    raise exception 'Call session identity mismatch';
  end if;
end $$;

create function public.bind_phone_assistant_provider(p_sid text, p_provider_id text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.phone_assistant_sessions set provider_call_id = p_provider_id
    where call_sid = p_sid and ended_at is null and coalesce(provider_call_id,p_provider_id) = p_provider_id;
  if not found then return false; end if;
  return true;
exception when unique_violation then return false;
end $$;

-- A SIP invitation can fail after binding. Only provider acceptance marks the call answered.
create function public.mark_phone_assistant_answered(p_sid text, p_provider_id text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.phone_assistant_sessions set answered_at = coalesce(answered_at, now()),
    email_status = case when ended_at is not null and email_status = 'waiting' then 'pending' else email_status end,
    next_email_at = case when ended_at is not null and email_status = 'waiting' then now() + interval '90 seconds' else next_email_at end
    where call_sid = p_sid and provider_call_id = p_provider_id;
  if not found then return false; end if;
  update public.call_logs set voice_assistant_answered = true, outcome = 'assistant-answered', updated_at = now()
    where call_sid = p_sid and not voice_assistant_answered and outcome not in ('voicemail','blacklisted');
  return true;
end $$;

create function public.append_phone_assistant_transcript(p_sid text,p_seq integer,p_role text,p_content text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.phone_assistant_transcript(call_sid,sequence,role,content)
    values(p_sid,p_seq,p_role,p_content) on conflict(call_sid,sequence) do nothing;
  if found then
    -- Late segments extend the grace period before summarization, without monopolizing the worker.
    update public.phone_assistant_sessions set next_email_at = greatest(next_email_at, now() + interval '30 seconds')
      where call_sid = p_sid and email_status = 'pending' and first_email_attempt_at is null
      and email_payload is null;
  end if;
end $$;

create function public.finalize_phone_assistant_session(p_sid text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.phone_assistant_sessions set ended_at = now(),
    email_status = case when answered_at is null then 'waiting' else 'pending' end,
    next_email_at = case when answered_at is not null then now() + interval '90 seconds' end
    where call_sid = p_sid and ended_at is null;
  return exists(select from public.phone_assistant_sessions where call_sid = p_sid and answered_at is not null);
end $$;

revoke all on function public.begin_phone_assistant_session(text,text,boolean),
  public.bind_phone_assistant_provider(text,text),
  public.mark_phone_assistant_answered(text,text),
  public.append_phone_assistant_transcript(text,integer,text,text),
  public.finalize_phone_assistant_session(text) from public, anon, authenticated;
grant execute on function public.begin_phone_assistant_session(text,text,boolean),
  public.bind_phone_assistant_provider(text,text),
  public.mark_phone_assistant_answered(text,text),
  public.append_phone_assistant_transcript(text,integer,text,text),
  public.finalize_phone_assistant_session(text) to service_role;

-- Include voice calls in Harry's existing authorized list_calls tool.
create function public.phone_assistant_transcripts_for_calls(p_sids text[])
returns table(call_sid text, transcription text) language sql stable security invoker set search_path = '' as $$
  select s.call_sid, concat(
    case when s.pilot then 'Private preview (simulated actions)' || chr(10) end,
    string_agg(case when t.role = 'user' then 'Caller: ' else 'Phone assistant: ' end || t.content, chr(10) order by t.sequence))
    from public.phone_assistant_sessions s
    join public.phone_assistant_transcript t on t.call_sid = s.call_sid
   where s.call_sid = any(p_sids) group by s.call_sid, s.pilot
$$;
revoke all on function public.phone_assistant_transcripts_for_calls(text[]) from public, anon, authenticated;
grant execute on function public.phone_assistant_transcripts_for_calls(text[]) to service_role;
