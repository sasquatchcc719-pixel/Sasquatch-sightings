-- Public PIN lookup is mediated by a durable, service-only account attempt budget.
-- No PIN values or client IPs are retained in this table.
create table public.location_partner_pin_attempts (
  partner_id uuid primary key,
  window_started_at timestamptz not null default clock_timestamp(),
  attempts smallint not null check (attempts between 1 and 5)
);
create index location_partner_pin_attempts_window_idx
  on public.location_partner_pin_attempts(window_started_at);
alter table public.location_partner_pin_attempts enable row level security;
revoke all on public.location_partner_pin_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.location_partner_pin_attempts to service_role;

create function public.consume_location_partner_pin_attempt(p_partner_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  allowed boolean;
  checked_at timestamptz := clock_timestamp();
begin
  if p_partner_id is null then return false; end if;
  -- Bounded expiry cleanup also covers nonexistent account IDs without creating
  -- an account-existence oracle or allowing permanent growth from random IDs.
  delete from public.location_partner_pin_attempts where partner_id in (
    select partner_id from public.location_partner_pin_attempts
    where window_started_at < checked_at - interval '1 day'
    order by window_started_at limit 100
  );
  insert into public.location_partner_pin_attempts(partner_id, window_started_at, attempts)
    values(p_partner_id, checked_at, 1)
  on conflict (partner_id) do update set
    window_started_at = case
      when public.location_partner_pin_attempts.window_started_at <= checked_at - interval '15 minutes' then checked_at
      else public.location_partner_pin_attempts.window_started_at end,
    attempts = case
      when public.location_partner_pin_attempts.window_started_at <= checked_at - interval '15 minutes' then 1
      else public.location_partner_pin_attempts.attempts + 1 end
  where public.location_partner_pin_attempts.window_started_at <= checked_at - interval '15 minutes'
    or public.location_partner_pin_attempts.attempts < 5
  returning true into allowed;
  return coalesce(allowed, false);
end;
$$;
revoke all on function public.consume_location_partner_pin_attempt(uuid) from public, anon, authenticated;
grant execute on function public.consume_location_partner_pin_attempt(uuid) to service_role;
