-- Hardware trackers are independent of employee shifts and payroll.
create table public.fleet_trackers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  enabled boolean not null default true,
  firmware text,
  battery_v double precision,
  gps_fix boolean not null default false,
  last_seen_at timestamptz,
  gps_at timestamptz,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  speed_mps double precision,
  bearing double precision,
  satellites integer,
  created_at timestamptz not null default now()
);

create table public.fleet_tracker_points (
  id bigint generated always as identity primary key,
  tracker_id uuid not null references public.fleet_trackers(id) on delete cascade,
  boot_id uuid not null,
  seq bigint not null check (seq between 0 and 4294967295),
  recorded_at timestamptz not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  speed_mps double precision check (speed_mps between 0 and 150),
  bearing double precision check (bearing >= 0 and bearing < 360),
  satellites integer check (satellites between 0 and 200),
  unique (tracker_id, boot_id, seq)
);
create index fleet_tracker_points_time on public.fleet_tracker_points (tracker_id, recorded_at desc);

alter table public.fleet_trackers enable row level security;
alter table public.fleet_tracker_points enable row level security;
revoke all on public.fleet_trackers, public.fleet_tracker_points from anon, authenticated;
grant all on public.fleet_trackers, public.fleet_tracker_points to service_role;
grant usage, select on sequence public.fleet_tracker_points_id_seq to service_role;

-- Only the server can execute this. Locking the device makes revocation,
-- duplicate delivery, and out-of-order offline uploads safe in one transaction.
create function public.ingest_fleet_tracker(p_token_hash text, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  tracker public.fleet_trackers;
  latest public.fleet_tracker_points;
  inserted_count integer;
begin
  select * into tracker from public.fleet_trackers
    where token_hash = p_token_hash and enabled for update;
  if not found then return jsonb_build_object('error', 'Unauthorized'); end if;
  if tracker.last_seen_at > clock_timestamp() - interval '1 second' then
    return jsonb_build_object('error', 'Too many requests');
  end if;

  insert into public.fleet_tracker_points
    (tracker_id, boot_id, seq, recorded_at, latitude, longitude, speed_mps, bearing, satellites)
  select tracker.id, (p->>'bootId')::uuid, (p->>'seq')::bigint,
    (p->>'recordedAt')::timestamptz, (p->>'lat')::double precision,
    (p->>'lng')::double precision, (p->>'speedMps')::double precision,
    (p->>'bearing')::double precision, (p->>'satellites')::integer
  from jsonb_array_elements(p_payload->'points') p
  where (p->>'recordedAt')::timestamptz >= now() - interval '30 days'
    and (p->>'recordedAt')::timestamptz <= now() + interval '5 minutes'
  on conflict (tracker_id, boot_id, seq) do nothing;
  get diagnostics inserted_count = row_count;

  select * into latest from public.fleet_tracker_points
    where tracker_id = tracker.id order by recorded_at desc, id desc limit 1;
  update public.fleet_trackers set
    firmware = p_payload->>'firmware', battery_v = (p_payload->>'batteryV')::double precision,
    gps_fix = (p_payload->>'gpsFix')::boolean, last_seen_at = clock_timestamp(),
    gps_at = latest.recorded_at, latitude = latest.latitude, longitude = latest.longitude,
    speed_mps = latest.speed_mps, bearing = latest.bearing, satellites = latest.satellites
  where id = tracker.id;
  delete from public.fleet_tracker_points
    where tracker_id = tracker.id and recorded_at < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'accepted', inserted_count, 'serverTime', clock_timestamp());
end;
$$;
revoke all on function public.ingest_fleet_tracker(text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_fleet_tracker(text, jsonb) to service_role;

-- At most 3,001 actual samples across a requested day; no fabricated/interpolated history.
create function public.fleet_tracker_history(p_tracker_id uuid, p_start timestamptz, p_end timestamptz)
returns table (recorded_at timestamptz, latitude double precision, longitude double precision,
  speed_mps double precision, bearing double precision)
language sql stable security invoker set search_path = public, pg_temp as $$
  select sampled.recorded_at, sampled.latitude, sampled.longitude, sampled.speed_mps, sampled.bearing
  from (
    select distinct on (floor(extract(epoch from (p.recorded_at - p_start)) * 3000 /
      greatest(extract(epoch from (p_end - p_start)), 1)))
      p.recorded_at, p.latitude, p.longitude, p.speed_mps, p.bearing
    from public.fleet_tracker_points p
    where p.tracker_id = p_tracker_id and p.recorded_at >= p_start and p.recorded_at < p_end
      and p_end > p_start and p_end - p_start <= interval '25 hours'
    order by floor(extract(epoch from (p.recorded_at - p_start)) * 3000 /
      greatest(extract(epoch from (p_end - p_start)), 1)), p.recorded_at desc
  ) sampled order by sampled.recorded_at;
$$;
revoke all on function public.fleet_tracker_history(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.fleet_tracker_history(uuid, timestamptz, timestamptz) to service_role;
