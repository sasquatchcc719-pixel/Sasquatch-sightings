-- Twilio owns the waiting callers/FIFO. This singleton fences the one cell-phone
-- dispatcher across concurrent waitUrl polls and provider callbacks.
create table public.appointment_call_dispatch (
  id boolean primary key default true check (id),
  queue_sid text,
  token uuid,
  worker_sid text,
  claimed_at timestamptz
);
alter table public.appointment_call_dispatch enable row level security;
revoke all on public.appointment_call_dispatch from public, anon, authenticated;
grant select, update on public.appointment_call_dispatch to service_role;
insert into public.appointment_call_dispatch (id) values (true);

alter table public.call_logs
  add column appointment_queued_at timestamptz,
  add column queue_worker_sid text;

create function public.claim_appointment_dispatch(p_token uuid)
returns boolean language plpgsql security invoker
set search_path = public, pg_temp as $$
begin
  update public.appointment_call_dispatch
    set token = p_token, worker_sid = null, claimed_at = now()
    where id and (token is null or
      (worker_sid is null and claimed_at < now() - interval '90 seconds'));
  return found;
end;
$$;

create function public.bind_appointment_dispatch(p_token uuid, p_worker_sid text)
returns boolean language plpgsql security invoker
set search_path = public, pg_temp as $$
begin
  update public.appointment_call_dispatch set worker_sid = p_worker_sid
    where id and token = p_token
      and (worker_sid is null or worker_sid = p_worker_sid);
  return found;
end;
$$;
revoke all on function public.claim_appointment_dispatch(uuid) from public, anon, authenticated;
revoke all on function public.bind_appointment_dispatch(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_appointment_dispatch(uuid) to service_role;
grant execute on function public.bind_appointment_dispatch(uuid, text) to service_role;
