-- Run after the migration. All test state rolls back; no phone calls are made.
begin;
update public.appointment_call_dispatch
  set token = null, worker_sid = null, claimed_at = null;
do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
begin
  if not public.claim_appointment_dispatch(a) then raise exception 'initial claim failed'; end if;
  if public.claim_appointment_dispatch(b) then raise exception 'double claim allowed'; end if;
  if public.bind_appointment_dispatch(b, 'CAstale') then raise exception 'stale attempt bound'; end if;
  if not public.bind_appointment_dispatch(a, 'CAworker') then raise exception 'worker not bound'; end if;
  if public.bind_appointment_dispatch(a, 'CAother') then raise exception 'worker identity changed'; end if;
  update public.appointment_call_dispatch set claimed_at = now() - interval '2 hours';
  if public.claim_appointment_dispatch(b) then raise exception 'live call lease expired'; end if;
  update public.appointment_call_dispatch set worker_sid = null;
  if not public.claim_appointment_dispatch(b) then raise exception 'stale pending claim not recovered'; end if;
  if public.bind_appointment_dispatch(a, 'CAstale') then raise exception 'expired attempt reanimated'; end if;
  if has_table_privilege('anon', 'public.appointment_call_dispatch', 'select')
    or has_table_privilege('authenticated', 'public.appointment_call_dispatch', 'update')
    or has_function_privilege('anon', 'public.claim_appointment_dispatch(uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.bind_appointment_dispatch(uuid,text)', 'execute')
  then raise exception 'public queue permissions exposed'; end if;
end; $$;
set local role service_role;
select public.bind_appointment_dispatch('22222222-2222-4222-8222-222222222222', 'CAservice') as service_role_can_bind;
reset role;
select 'Dispatcher isolation and permission assertions passed' as verification;
rollback;
