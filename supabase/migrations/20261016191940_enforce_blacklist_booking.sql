-- One normalized, server-only lookup for both calls and booking enforcement.
-- Blacklist details are private; all management routes use the service role.
alter table public.blacklist enable row level security;

create or replace function public.is_phone_blacklisted(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) >= 10
    and exists (
      select 1 from public.blacklist b
      where right(regexp_replace(b.phone, '[^0-9]', '', 'g'), 10)
          = right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 10)
    );
$$;

revoke all on function public.is_phone_blacklisted(text) from public, anon, authenticated;
grant execute on function public.is_phone_blacklisted(text) to service_role;

create or replace function public.prevent_blacklisted_appointment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text;
begin
  -- Preserve historical records and let staff cancel or complete existing work.
  if new.status in ('cancelled', 'completed') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.customer_id is not distinct from old.customer_id
      and new.appointment_date is not distinct from old.appointment_date
      and new.start_time is not distinct from old.start_time
      and new.end_time is not distinct from old.end_time
      and not (old.status in ('cancelled', 'completed')) then
      return new;
    end if;
  end if;

  select phone into v_phone from public.ops_customers where id = new.customer_id;
  if public.is_phone_blacklisted(v_phone) then
    raise exception using
      errcode = 'P0001',
      message = 'This customer is blacklisted and cannot book appointments.';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_blacklisted_appointment() from public, anon, authenticated;

-- Runs before notifications, invoice creation, and other AFTER INSERT effects.
create trigger a_prevent_blacklisted_appointment
before insert or update of customer_id, appointment_date, start_time, end_time, status
on public.ops_appointments
for each row execute function public.prevent_blacklisted_appointment();
