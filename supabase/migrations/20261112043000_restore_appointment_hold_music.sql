-- Keep the inbound customer enqueued on hold music while separate screened
-- outbound calls ring the primary and secondary phones.
alter table public.appointment_call_dispatch
  add column caller_sid text,
  add column stage text not null default 'primary'
    check (stage in ('primary', 'secondary')),
  add column accepted boolean not null default false;

-- Clear the old direct-dequeue lease. Its worker_sid was the inbound caller,
-- while the restored dispatcher tracks a separate outbound agent call.
update public.appointment_call_dispatch
set token = null,
    worker_sid = null,
    caller_sid = null,
    stage = 'primary',
    accepted = false,
    claimed_at = null
where id;

create function public.claim_appointment_dispatch_v2(
  p_token uuid,
  p_caller_sid text,
  p_stage text
)
returns boolean language plpgsql security invoker
set search_path = public, pg_temp as $$
begin
  if p_caller_sid !~ '^CA[0-9a-fA-F]{32}$'
     or p_stage not in ('primary', 'secondary') then
    return false;
  end if;
  update public.appointment_call_dispatch
    set token = p_token,
        worker_sid = null,
        caller_sid = p_caller_sid,
        stage = p_stage,
        accepted = false,
        claimed_at = now()
    where id and (
      token is null or
      (worker_sid is null and claimed_at < now() - interval '30 seconds')
    );
  return found;
end;
$$;

create function public.advance_appointment_dispatch(
  p_token uuid,
  p_worker_sid text,
  p_next_token uuid
)
returns boolean language plpgsql security invoker
set search_path = public, pg_temp as $$
begin
  update public.appointment_call_dispatch
    set token = p_next_token,
        worker_sid = null,
        stage = 'secondary',
        accepted = false,
        claimed_at = now()
    where id
      and token = p_token
      and worker_sid = p_worker_sid
      and stage = 'primary'
      and not accepted;
  return found;
end;
$$;

create function public.accept_appointment_dispatch(
  p_token uuid,
  p_worker_sid text
)
returns boolean language plpgsql security invoker
set search_path = public, pg_temp as $$
begin
  update public.appointment_call_dispatch
    set accepted = true
    where id
      and token = p_token
      and worker_sid = p_worker_sid;
  return found;
end;
$$;

revoke all on function public.claim_appointment_dispatch_v2(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.advance_appointment_dispatch(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.accept_appointment_dispatch(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_appointment_dispatch_v2(uuid, text, text)
  to service_role;
grant execute on function public.advance_appointment_dispatch(uuid, text, uuid)
  to service_role;
grant execute on function public.accept_appointment_dispatch(uuid, text)
  to service_role;
