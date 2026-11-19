alter table public.phone_assistant_sessions
  add column coaching_review jsonb,
  add column coaching_due_at timestamptz not null default now(),
  add column coaching_excluded boolean not null default false;
create index phone_assistant_coaching_due on public.phone_assistant_sessions(coaching_due_at)
  where ended_at is not null and answered_at is not null and coaching_review is null;

-- If final transcription arrives after hangup, review the complete call again.
-- Moving the due time also invalidates an in-flight review's lease.
create function public.refresh_ended_phone_coaching() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  update public.phone_assistant_sessions
    set coaching_due_at = clock_timestamp() + interval '90 seconds', coaching_review = null
    where call_sid = new.call_sid and ended_at is not null;
  return new;
end $$;
revoke all on function public.refresh_ended_phone_coaching() from public, anon, authenticated;
create trigger phone_transcript_refresh_coaching after insert on public.phone_assistant_transcript
  for each row execute function public.refresh_ended_phone_coaching();
notify pgrst, 'reload schema';
