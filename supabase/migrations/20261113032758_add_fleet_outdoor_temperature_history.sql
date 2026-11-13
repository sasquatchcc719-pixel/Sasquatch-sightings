create table public.fleet_outdoor_temperature (
  observed_at timestamptz primary key,
  temperature_f double precision not null,
  station_name text not null
);
alter table public.fleet_outdoor_temperature enable row level security;
revoke all on public.fleet_outdoor_temperature from public, anon, authenticated;
grant all on public.fleet_outdoor_temperature to service_role;

create function public.fleet_temperature_spread(p_tracker_id uuid, p_days integer)
returns table (minute_at timestamptz, temperature_f double precision,
  outdoor_f double precision, spread_f double precision)
language sql stable security invoker set search_path = public, pg_temp as $$
  with periods as (
    select observed_at, temperature_f,
      least(observed_at + interval '90 minutes', lead(observed_at) over (order by observed_at)) as expires_at
    from public.fleet_outdoor_temperature
    where observed_at >= now() - make_interval(days => p_days) - interval '90 minutes'
  )
  select date_bin(
           case p_days when 1 then interval '2 minutes' when 7 then interval '15 minutes'
             when 30 then interval '1 hour' when 90 then interval '3 hours' end,
           r.minute_at, '2000-01-01 00:00:00+00'::timestamptz
         ) as bucket,
         avg(r.temperature_c) * 1.8 + 32,
         avg(p.temperature_f),
         avg(r.temperature_c * 1.8 + 32 - p.temperature_f)
  from periods p
  join public.fleet_temperature_readings r
    on r.tracker_id = p_tracker_id and r.minute_at >= p.observed_at and r.minute_at < p.expires_at
  where p_days in (1,7,30,90)
    and r.minute_at >= now() - make_interval(days => p_days)
  group by bucket order by bucket;
$$;
revoke all on function public.fleet_temperature_spread(uuid, integer) from public, anon, authenticated;
grant execute on function public.fleet_temperature_spread(uuid, integer) to service_role;
