alter table public.fleet_trackers
  add column probe_temperature_c double precision check (probe_temperature_c between -55 and 125),
  add column probe_received_at timestamptz,
  add column telemetry_network text check (telemetry_network in ('cellular', 'wifi'));

create or replace function public.ingest_fleet_tracker(p_token_hash text, p_payload jsonb)
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
    probe_temperature_c = (p_payload->>'temperatureC')::double precision,
    probe_received_at = case when p_payload->>'temperatureC' is not null then clock_timestamp() end,
    telemetry_network = p_payload->>'network',
    gps_fix = (p_payload->>'gpsFix')::boolean, last_seen_at = clock_timestamp(),
    gps_at = latest.recorded_at, latitude = latest.latitude, longitude = latest.longitude,
    speed_mps = latest.speed_mps, bearing = latest.bearing, satellites = latest.satellites
  where id = tracker.id;
  delete from public.fleet_tracker_points
    where tracker_id = tracker.id and recorded_at < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'accepted', inserted_count, 'serverTime', clock_timestamp());
end;
$$;
