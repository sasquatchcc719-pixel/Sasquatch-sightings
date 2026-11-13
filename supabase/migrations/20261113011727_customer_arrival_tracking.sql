create table public.customer_arrival_links (
  appointment_id uuid primary key references public.ops_appointments(id) on delete cascade,
  tracker_id uuid not null references public.fleet_trackers(id) on delete cascade,
  tracker_assigned_at timestamptz not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  started_at timestamptz not null,
  destination_lat double precision not null check (destination_lat between -90 and 90),
  destination_lng double precision not null check (destination_lng between -180 and 180),
  closed_reason text check (closed_reason in ('arrived', 'ended'))
);

create index customer_arrival_links_tracker_started
  on public.customer_arrival_links (tracker_id, started_at desc);

alter table public.customer_arrival_links enable row level security;
revoke all on public.customer_arrival_links from public, anon, authenticated;
grant select, insert, update on public.customer_arrival_links to service_role;

create function public.open_customer_arrival_link(
  p_appointment_id uuid, p_started_at timestamptz, p_address_id uuid, p_customer_id uuid,
  p_lat double precision, p_lng double precision, p_token_hash text
)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  job public.ops_appointments;
  tracker record;
  was_arrived boolean;
begin
  select * into job from public.ops_appointments where id = p_appointment_id for no key update;
  if not found or job.status is distinct from 'on_my_way' or job.parked_at is not null
    or job.on_my_way_at is distinct from p_started_at or p_started_at is null
    or p_started_at not between now() - interval '2 hours' and now()
    or job.service_address_id is distinct from p_address_id or p_address_id is null
    or job.customer_id is distinct from p_customer_id
    or job.appointment_date is distinct from (now() at time zone 'America/Denver')::date
    or job.arrived_at >= p_started_at or job.job_started_at >= p_started_at
  then return false; end if;

  select cfg.tracker_id, cfg.enabled_at
  into tracker
  from public.fleet_dispatch_tracking cfg
  join public.staff_users s on s.id = cfg.staff_user_id and s.is_active
  join public.fleet_trackers t on t.id = cfg.tracker_id and t.enabled
  where job.assigned_staff_user_id in (s.id, s.user_id)
    and cfg.enabled_at <= p_started_at
  limit 1;
  if not found or exists (
    select 1 from public.fleet_dispatch_tracking cfg
    join public.staff_users s on s.id = cfg.staff_user_id and s.is_active
    join public.fleet_trackers t on t.id = cfg.tracker_id and t.enabled
    where job.assigned_staff_user_id in (s.id, s.user_id)
      and cfg.tracker_id <> tracker.tracker_id
  ) then return false; end if;

  select exists (
    select 1 from public.fleet_job_visits v
    where v.appointment_id = job.id and v.tracker_id = tracker.tracker_id
      and v.arrived_at >= p_started_at
  ) or exists (
    select 1 from public.fleet_tracker_points p
    where p.tracker_id = tracker.tracker_id and p.recorded_at between p_started_at and now() + interval '5 seconds'
      and p.speed_mps <= 2.5 and p.satellites >= 4
      and public.fleet_distance_m(p.latitude, p.longitude, p_lat, p_lng) <= 75
  ) into was_arrived;

  if was_arrived then return false; end if;
  insert into public.customer_arrival_links
    (appointment_id, tracker_id, tracker_assigned_at, token_hash, started_at, destination_lat, destination_lng)
  values (job.id, tracker.tracker_id, tracker.enabled_at, p_token_hash, p_started_at, p_lat, p_lng)
  on conflict (appointment_id) do update set
    tracker_id = excluded.tracker_id,
    tracker_assigned_at = excluded.tracker_assigned_at,
    token_hash = excluded.token_hash,
    started_at = excluded.started_at,
    destination_lat = excluded.destination_lat,
    destination_lng = excluded.destination_lng,
    closed_reason = null
  where customer_arrival_links.started_at < excluded.started_at;
  return exists (
    select 1 from public.customer_arrival_links l
    where l.appointment_id = job.id and l.token_hash = p_token_hash
      and l.tracker_id = tracker.tracker_id and l.tracker_assigned_at = tracker.enabled_at
      and l.closed_reason is null
  );
end;
$$;

create schema if not exists private;

-- Appointment edits also run as authenticated staff. This trigger can only
-- close the matching appointment's link and is outside the exposed schema.
create function private.close_customer_arrival_from_job()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.customer_arrival_links l
  set closed_reason = case
    when new.status in ('in_progress', 'completed')
      or new.arrived_at >= l.started_at or new.job_started_at >= l.started_at
    then 'arrived' else 'ended' end
  where l.appointment_id = new.id and l.closed_reason is null
    and (new.status is distinct from 'on_my_way' or new.parked_at is not null
      or new.on_my_way_at is distinct from l.started_at
      or new.arrived_at >= l.started_at or new.job_started_at >= l.started_at
      or new.assigned_staff_user_id is distinct from old.assigned_staff_user_id
      or new.service_address_id is distinct from old.service_address_id
      or new.customer_id is distinct from old.customer_id
      or new.appointment_date is distinct from old.appointment_date
      or new.start_time is distinct from old.start_time);
  return new;
end;
$$;

create trigger close_customer_arrival_on_job_change
  after update of status, parked_at, on_my_way_at, arrived_at, job_started_at,
    assigned_staff_user_id, service_address_id, customer_id, appointment_date, start_time
  on public.ops_appointments for each row execute function private.close_customer_arrival_from_job();

create function public.close_customer_arrival_from_gps()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  update public.customer_arrival_links l set closed_reason = 'arrived'
  where l.closed_reason is null and l.started_at > now() - interval '2 hours'
    and exists (
      select 1 from arrival_points p
      where p.tracker_id = l.tracker_id
        and p.recorded_at between l.started_at and now() + interval '5 seconds'
        and p.speed_mps <= 2.5 and p.satellites >= 4
        and public.fleet_distance_m(p.latitude, p.longitude, l.destination_lat, l.destination_lng) <= 75
    );
  return null;
end;
$$;

create trigger close_customer_arrival_on_gps
  after insert on public.fleet_tracker_points referencing new table as arrival_points
  for each statement execute function public.close_customer_arrival_from_gps();

-- A single snapshot checks both the appointment and the tracker before routing.
create function public.read_customer_arrival_link(p_token_hash text)
returns table (
  status text, latitude double precision, longitude double precision,
  destination_lat double precision, destination_lng double precision
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with trip as (
    select l.destination_lat, l.destination_lng, t.latitude, t.longitude,
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
    case when status = 'en_route' then destination_lng end
  from trip;
$$;

revoke all on function public.open_customer_arrival_link(uuid,timestamptz,uuid,uuid,double precision,double precision,text),
  public.read_customer_arrival_link(text), private.close_customer_arrival_from_job(), public.close_customer_arrival_from_gps()
  from public, anon, authenticated;
grant execute on function public.open_customer_arrival_link(uuid,timestamptz,uuid,uuid,double precision,double precision,text),
  public.read_customer_arrival_link(text), private.close_customer_arrival_from_job(), public.close_customer_arrival_from_gps()
  to service_role;
