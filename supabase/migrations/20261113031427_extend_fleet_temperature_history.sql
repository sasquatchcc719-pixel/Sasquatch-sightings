create function public.fleet_temperature_history_summary(p_tracker_id uuid, p_days integer)
returns table (
  minute_at timestamptz,
  temperature_f double precision,
  low_f double precision,
  high_f double precision
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select date_bin(
           case p_days
             when 1 then interval '2 minutes'
             when 7 then interval '15 minutes'
             when 30 then interval '1 hour'
             when 90 then interval '3 hours'
           end,
           r.minute_at,
           '2000-01-01 00:00:00+00'::timestamptz
         ) as bucket,
         avg(r.temperature_c) * 1.8 + 32,
         min(r.temperature_c) * 1.8 + 32,
         max(r.temperature_c) * 1.8 + 32
  from public.fleet_temperature_readings r
  where r.tracker_id = p_tracker_id
    and p_days in (1, 7, 30, 90)
    and r.minute_at >= now() - make_interval(days => p_days)
  group by bucket
  order by bucket;
$$;

revoke all on function public.fleet_temperature_history_summary(uuid, integer) from public, anon, authenticated;
grant execute on function public.fleet_temperature_history_summary(uuid, integer) to service_role;

-- Keep the prior response available during deployment and rollback.
create or replace function public.fleet_temperature_history(p_tracker_id uuid, p_days integer)
returns table (minute_at timestamptz, temperature_f double precision)
language sql stable security invoker set search_path = public, pg_temp as $$
  select summary.minute_at, summary.temperature_f
  from public.fleet_temperature_history_summary(
    p_tracker_id, case when p_days = 7 then 7 else 1 end
  ) summary
  order by summary.minute_at;
$$;
