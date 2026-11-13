alter table public.fleet_trackers
  add column temperature_low_f numeric check (temperature_low_f between -67 and 257),
  add column temperature_high_f numeric check (temperature_high_f between -67 and 257),
  add column temperature_alarm_sent text check (temperature_alarm_sent in ('low', 'high')),
  add constraint fleet_tracker_temperature_limits check (temperature_low_f < temperature_high_f);

create table public.fleet_temperature_readings (
  tracker_id uuid not null references public.fleet_trackers(id) on delete cascade,
  minute_at timestamptz not null,
  temperature_c double precision not null check (temperature_c between -55 and 125),
  primary key (tracker_id, minute_at)
);
alter table public.fleet_temperature_readings enable row level security;
revoke all on public.fleet_temperature_readings from public, anon, authenticated;
grant all on public.fleet_temperature_readings to service_role;

create function public.record_fleet_temperature()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  insert into public.fleet_temperature_readings (tracker_id, minute_at, temperature_c)
  values (new.id, date_trunc('minute', new.probe_received_at), new.probe_temperature_c)
  on conflict (tracker_id, minute_at) do update set temperature_c = excluded.temperature_c;
  return new;
end;
$$;
revoke all on function public.record_fleet_temperature() from public, anon, authenticated;
grant execute on function public.record_fleet_temperature() to service_role;

create trigger fleet_probe_reading after update of probe_received_at on public.fleet_trackers
for each row when (new.probe_received_at is not null and new.probe_temperature_c is not null
  and new.probe_received_at is distinct from old.probe_received_at)
execute function public.record_fleet_temperature();

insert into public.fleet_temperature_readings (tracker_id, minute_at, temperature_c)
select id, date_trunc('minute', probe_received_at), probe_temperature_c
from public.fleet_trackers
where probe_received_at is not null and probe_temperature_c is not null;

create function public.fleet_temperature_history(p_tracker_id uuid, p_days integer)
returns table (minute_at timestamptz, temperature_f double precision)
language sql stable security invoker set search_path = public, pg_temp as $$
  select date_bin(case when p_days = 7 then interval '15 minutes' else interval '2 minutes' end,
           r.minute_at, '2000-01-01 00:00:00+00'::timestamptz) as bucket,
         avg(r.temperature_c) * 1.8 + 32
  from public.fleet_temperature_readings r
  where r.tracker_id = p_tracker_id
    and r.minute_at >= now() - make_interval(days => case when p_days = 7 then 7 else 1 end)
  group by bucket
  order by bucket;
$$;
revoke all on function public.fleet_temperature_history(uuid, integer) from public, anon, authenticated;
grant execute on function public.fleet_temperature_history(uuid, integer) to service_role;
