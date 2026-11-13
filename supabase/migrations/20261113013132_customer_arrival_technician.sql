drop function public.read_customer_arrival_link(text);

create function public.read_customer_arrival_link(p_token_hash text)
returns table (
  status text, latitude double precision, longitude double precision,
  destination_lat double precision, destination_lng double precision,
  technician_first_name text, technician_photo_url text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with trip as (
    select l.destination_lat, l.destination_lng, t.latitude, t.longitude,
      split_part(ltrim(s.display_name), ' ', 1) as first_name, s.profile_image_url,
      case
        when l.closed_reason = 'arrived' then 'arrived'
        when l.closed_reason is not null or l.started_at <= now() - interval '2 hours'
          or a.status is distinct from 'on_my_way' or a.on_my_way_at is distinct from l.started_at
          or a.parked_at is not null or cfg.enabled_at is distinct from l.tracker_assigned_at
          or exists (
            select 1 from public.customer_arrival_links newer
            where newer.tracker_id = l.tracker_id and newer.appointment_id <> l.appointment_id
              and newer.started_at >= l.started_at
          )
          or not coalesce(t.enabled and s.is_active and a.assigned_staff_user_id in (s.id, s.user_id), false)
        then 'ended'
        when exists (
          select 1 from public.fleet_job_visits v
          where v.appointment_id = l.appointment_id and v.tracker_id = l.tracker_id and v.arrived_at >= l.started_at
        ) or exists (
          -- Covers GPS arriving in the same transaction window as link creation.
          select 1 from public.fleet_tracker_points p
          where p.tracker_id = l.tracker_id and p.recorded_at between l.started_at and now() + interval '5 seconds'
            and p.speed_mps <= 2.5 and p.satellites >= 4
            and public.fleet_distance_m(p.latitude, p.longitude, l.destination_lat, l.destination_lng) <= 75
        ) then 'arrived'
        when t.gps_fix and t.last_seen_at >= now() - interval '45 seconds'
          and t.gps_at between greatest(l.started_at, now() - interval '30 seconds') and now() + interval '5 seconds'
          and t.latitude is not null and t.longitude is not null
          and (t.latitude <> 0 or t.longitude <> 0)
          and t.satellites >= 4
        then 'en_route' else 'waiting' end as status
    from public.customer_arrival_links l
    join public.ops_appointments a on a.id = l.appointment_id
    left join public.fleet_dispatch_tracking cfg on cfg.tracker_id = l.tracker_id
    left join public.staff_users s on s.id = cfg.staff_user_id
    left join public.fleet_trackers t on t.id = l.tracker_id
    where l.token_hash = p_token_hash
  )
  select status,
    case when status = 'en_route' then latitude end,
    case when status = 'en_route' then longitude end,
    case when status = 'en_route' then destination_lat end,
    case when status = 'en_route' then destination_lng end,
    case when status in ('en_route', 'waiting') then first_name end,
    case when status in ('en_route', 'waiting') then profile_image_url end
  from trip;
$$;

revoke all on function public.read_customer_arrival_link(text) from public, anon, authenticated;
grant execute on function public.read_customer_arrival_link(text) to service_role;
