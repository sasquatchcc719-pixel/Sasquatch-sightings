-- Bind the shared TypeScript slot picker to the database state it inspected.
-- Reuse the existing commercial calendar snapshot, including staff availability,
-- recurring work, blocks, identity matches and blacklist changes.
create function public.phone_booking_calendar_version(p_date date, p_contact jsonb)
returns text language sql stable security invoker set search_path = '' as $$
  select public.preview_outreach_measurement_context(p_date,
    jsonb_build_object('mode','new_customer','customer',p_contact)) ->> 'version';
$$;

create function public.lock_phone_booking_calendar(p_date date, p_staff_id uuid, p_contact jsonb, p_version text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_version is null or p_staff_id is null or p_date is null then raise exception 'Calendar validation required'; end if;
  perform set_config('lock_timeout','5s',true);
  perform pg_advisory_xact_lock(hashtextextended(p_staff_id::text || ':' || p_date::text,0));
  -- Manual schedule writers need not take the advisory lock. Use the same
  -- short lock order as commercial measurement confirmation, without external
  -- calls inside this transaction.
  lock table public.ops_appointments in share row exclusive mode;
  lock table public.ops_calendar_events,public.staff_users,public.staff_daily_availability,
    public.availability_templates,public.availability_overrides,public.blacklist in share mode;
  lock table public.ops_customers,public.ops_service_addresses in share row exclusive mode;
  if public.phone_booking_calendar_version(p_date,p_contact) is distinct from p_version then
    raise exception 'Calendar or customer changed; recheck availability' using errcode='serialization_failure';
  end if;
end;
$$;
revoke all on function public.phone_booking_calendar_version(date,jsonb),public.lock_phone_booking_calendar(date,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.phone_booking_calendar_version(date,jsonb),public.lock_phone_booking_calendar(date,uuid,jsonb,text) to service_role;
