-- Private vehicle evidence is deliberately separate from customer invoices,
-- technician time clocks, job status, and public/technician API payloads.
create table public.fleet_dispatch_tracking (
  tracker_id uuid primary key references public.fleet_trackers(id),
  staff_user_id uuid not null references public.staff_users(id),
  base_label text not null,
  base_latitude double precision not null check (base_latitude between -90 and 90),
  base_longitude double precision not null check (base_longitude between -180 and 180),
  enabled_at timestamptz not null default now()
);
create table public.fleet_job_visits (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.fleet_trackers(id),
  staff_user_id uuid not null references public.staff_users(id),
  appointment_id uuid not null references public.ops_appointments(id),
  tracker_name text not null,
  location_label text not null,
  arrived_at timestamptz not null,
  departed_at timestamptz,
  unique (tracker_id, appointment_id, arrived_at),
  check (departed_at is null or departed_at >= arrived_at)
);
create index fleet_job_visits_appointment on public.fleet_job_visits(appointment_id, arrived_at);
create table public.fleet_job_trips (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.fleet_trackers(id),
  staff_user_id uuid not null references public.staff_users(id),
  tracker_name text not null,
  origin_appointment_id uuid references public.ops_appointments(id),
  destination_appointment_id uuid references public.ops_appointments(id),
  origin_label text not null,
  destination_label text,
  departed_at timestamptz not null,
  arrived_at timestamptz,
  last_observed_at timestamptz not null,
  confirmed boolean not null default false,
  status text not null default 'traveling' check (status in ('traveling','arrived','incomplete')),
  observed_distance_m double precision not null default 0,
  signal_gaps integer not null default 0,
  route jsonb not null default '[]',
  route_truncated boolean not null default false,
  check (arrived_at is null or arrived_at >= departed_at)
);
create index fleet_job_trips_origin on public.fleet_job_trips(origin_appointment_id, departed_at);
create index fleet_job_trips_destination on public.fleet_job_trips(destination_appointment_id, departed_at);
create table public.fleet_dispatch_state (
  tracker_id uuid primary key references public.fleet_dispatch_tracking(tracker_id) on delete cascade,
  last_at timestamptz,
  latitude double precision,
  longitude double precision,
  speed_mps double precision,
  stable_stop jsonb,
  candidate_stop jsonb,
  trip_id uuid references public.fleet_job_trips(id) on delete set null,
  uncertain boolean not null default false
);
alter table public.fleet_dispatch_tracking enable row level security;
alter table public.fleet_job_visits enable row level security;
alter table public.fleet_job_trips enable row level security;
alter table public.fleet_dispatch_state enable row level security;
revoke all on public.fleet_dispatch_tracking, public.fleet_job_visits, public.fleet_job_trips, public.fleet_dispatch_state from public, anon, authenticated;
grant all on public.fleet_dispatch_tracking, public.fleet_job_visits, public.fleet_job_trips, public.fleet_dispatch_state to service_role;

create function public.fleet_distance_m(a double precision,b double precision,c double precision,d double precision)
returns double precision language sql immutable strict security invoker set search_path=public,pg_temp as $$
  select 12742000 * asin(sqrt(least(1.0, power(sin(radians(c-a)/2),2) + cos(radians(a))*cos(radians(c))*power(sin(radians(d-b)/2),2))));
$$;
revoke all on function public.fleet_distance_m(double precision,double precision,double precision,double precision) from public,anon,authenticated;
grant execute on function public.fleet_distance_m(double precision,double precision,double precision,double precision) to service_role;

-- Statement-level transition tables contain only newly inserted points, not
-- duplicate retransmissions. Sorting preserves chronological offline batches.
create function public.record_fleet_job_journeys()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  p record; cfg public.fleet_dispatch_tracking; st public.fleet_dispatch_state;
  trip public.fleet_job_trips; target jsonb; candidate jsonb; stable jsonb;
  job record; tracker_name text; staff_auth uuid; visit_id uuid;
  gap double precision; step double precision; outside boolean; bad_step boolean;
  started timestamptz; radius double precision; sample jsonb;
begin
  for p in select * from inserted_points order by tracker_id,recorded_at,id loop
    select * into cfg from public.fleet_dispatch_tracking where tracker_id=p.tracker_id for update;
    if not found or p.recorded_at < cfg.enabled_at or (p.latitude=0 and p.longitude=0) or coalesce(p.satellites,4)<4 then continue; end if;
    insert into public.fleet_dispatch_state(tracker_id) values(p.tracker_id) on conflict do nothing;
    select * into st from public.fleet_dispatch_state where tracker_id=p.tracker_id for update;
    -- Late older uploads remain in raw history; never rewrite an established
    -- invoice timeline from an out-of-order point.
    if st.last_at is not null and p.recorded_at <= st.last_at then continue; end if;
    select name into tracker_name from public.fleet_trackers where id=p.tracker_id;
    select user_id into staff_auth from public.staff_users where id=cfg.staff_user_id;
    gap=extract(epoch from (p.recorded_at-st.last_at));
    step=public.fleet_distance_m(st.latitude,st.longitude,p.latitude,p.longitude);
    bad_step=coalesce(gap>90 or (gap>0 and step/gap>55),false);
    if bad_step then st.candidate_stop=null; st.uncertain=true; end if;
    stable=st.stable_stop;

    if stable is not null then
      radius=case when stable->>'kind'='base' then 200 else 150 end;
      outside=public.fleet_distance_m((stable->>'lat')::double precision,(stable->>'lng')::double precision,p.latitude,p.longitude)>radius;
      if st.trip_id is null and outside then
        insert into public.fleet_job_trips(tracker_id,staff_user_id,tracker_name,origin_appointment_id,origin_label,departed_at,last_observed_at,signal_gaps)
        values(p.tracker_id,cfg.staff_user_id,tracker_name,(stable->>'appointment_id')::uuid,stable->>'label',p.recorded_at,p.recorded_at,case when st.uncertain and not bad_step then 1 else 0 end) returning id into st.trip_id;
      elsif st.trip_id is not null and not outside then
        delete from public.fleet_job_trips where id=st.trip_id and not confirmed;
        st.trip_id=null;
      end if;
      if st.trip_id is not null and outside then
        select * into trip from public.fleet_job_trips where id=st.trip_id;
        if bad_step then
          update public.fleet_job_trips set departed_at=p.recorded_at,route='[]',observed_distance_m=0 where id=st.trip_id;
          trip.departed_at=p.recorded_at;
        end if;
        if p.recorded_at-trip.departed_at>=interval '30 seconds' then
          update public.fleet_job_trips set confirmed=true where id=st.trip_id;
          if stable->>'visit_id' is not null then
            update public.fleet_job_visits set departed_at=trip.departed_at where id=(stable->>'visit_id')::uuid;
          end if;
          st.stable_stop=null; stable=null; st.candidate_stop=null;
        end if;
      end if;
    end if;

    if stable is null then
      target=null;
      if coalesce(p.speed_mps,0)<=2.5 then
        if public.fleet_distance_m(cfg.base_latitude,cfg.base_longitude,p.latitude,p.longitude)<=150 then
          target=jsonb_build_object('kind','base','label',cfg.base_label,'lat',cfg.base_latitude,'lng',cfg.base_longitude);
        else
          select a.id,sa.street_1,sa.city,coalesce(sa.latitude,a.gps_lat)::double precision lat,coalesce(sa.longitude,a.gps_lng)::double precision lng
          into job from public.ops_appointments a
          join public.ops_service_addresses sa on sa.id=a.service_address_id
          where a.appointment_date=(p.recorded_at at time zone 'America/Denver')::date
            and a.assigned_staff_user_id in (cfg.staff_user_id,staff_auth)
            and a.status<>'cancelled' and a.parked_at is null
            and (
              (sa.geocoded_at is not null and sa.geocode_source in ('nominatim-street-verified','nominatim-street-verified-backfill','colorado-state-address-point','repair:colorado-springs-address-point'))
              or (sa.latitude is null and a.gps_lat is not null and a.gps_lng is not null)
            )
            and public.fleet_distance_m(coalesce(sa.latitude,a.gps_lat)::double precision,coalesce(sa.longitude,a.gps_lng)::double precision,p.latitude,p.longitude)<=100
          order by public.fleet_distance_m(coalesce(sa.latitude,a.gps_lat)::double precision,coalesce(sa.longitude,a.gps_lng)::double precision,p.latitude,p.longitude),abs(extract(epoch from ((p.recorded_at at time zone 'America/Denver')::time-a.start_time))),a.id limit 1;
          if found then target=jsonb_build_object('kind','job','appointment_id',job.id,'label',concat_ws(', ',job.street_1,job.city),'lat',job.lat,'lng',job.lng); end if;
        end if;
      end if;
      if target is not null then
        candidate=st.candidate_stop;
        if candidate is null or candidate->>'kind'<>target->>'kind' or coalesce(candidate->>'appointment_id','')<>coalesce(target->>'appointment_id','') then
          candidate=target||jsonb_build_object('since',p.recorded_at,'gps_lat',p.latitude,'gps_lng',p.longitude);
        end if;
        st.candidate_stop=candidate;
        started=(candidate->>'since')::timestamptz;
        if p.recorded_at-started>=interval '60 seconds' then
          if st.trip_id is not null then
            update public.fleet_job_trips set
              confirmed=true,status='arrived',arrived_at=started,destination_label=target->>'label',destination_appointment_id=(target->>'appointment_id')::uuid,
              route=coalesce((select jsonb_agg(v order by ord) from jsonb_array_elements(route) with ordinality e(v,ord) where (v->>'at')::timestamptz<started),'[]')||jsonb_build_array(jsonb_build_object('at',started,'lat',(candidate->>'gps_lat')::double precision,'lng',(candidate->>'gps_lng')::double precision,'gap',false))
            where id=st.trip_id;
            st.trip_id=null;
          end if;
          if target->>'kind'='job' then
            insert into public.fleet_job_visits(tracker_id,staff_user_id,appointment_id,tracker_name,location_label,arrived_at)
            values(p.tracker_id,cfg.staff_user_id,(target->>'appointment_id')::uuid,tracker_name,target->>'label',started) returning id into visit_id;
            target=target||jsonb_build_object('visit_id',visit_id);
          end if;
          st.stable_stop=target; st.candidate_stop=null; st.uncertain=false;
        end if;
      else
        st.candidate_stop=null;
        if st.trip_id is null and coalesce(p.speed_mps,0)>1 then
          insert into public.fleet_job_trips(tracker_id,staff_user_id,tracker_name,origin_label,departed_at,last_observed_at,confirmed,signal_gaps)
          values(p.tracker_id,cfg.staff_user_id,tracker_name,'Tracking began away from a confirmed stop',p.recorded_at,p.recorded_at,true,case when st.uncertain and not bad_step then 1 else 0 end) returning id into st.trip_id;
        end if;
      end if;
    end if;

    if st.trip_id is not null then
      select * into trip from public.fleet_job_trips where id=st.trip_id;
      sample=jsonb_build_object('at',p.recorded_at,'lat',p.latitude,'lng',p.longitude,'gap',bad_step);
      update public.fleet_job_trips set last_observed_at=p.recorded_at,
        observed_distance_m=observed_distance_m+case when not bad_step and gap>0 and st.last_at>=departed_at and (coalesce(p.speed_mps,0)>1 or coalesce(st.speed_mps,0)>1) then coalesce(step,0) else 0 end,
        signal_gaps=signal_gaps+case when bad_step then 1 else 0 end,
        route=case when jsonb_array_length(route)<2000 and (jsonb_array_length(route)=0 or bad_step or p.recorded_at-(route->-1->>'at')::timestamptz>=interval '15 seconds') then route||jsonb_build_array(sample) else route end,
        route_truncated=route_truncated or jsonb_array_length(route)>=2000
      where id=st.trip_id;
    end if;
    update public.fleet_dispatch_state set last_at=p.recorded_at,latitude=p.latitude,longitude=p.longitude,speed_mps=p.speed_mps,stable_stop=st.stable_stop,candidate_stop=st.candidate_stop,trip_id=st.trip_id,uncertain=st.uncertain where tracker_id=p.tracker_id;
  end loop;
  return null;
end;
$$;
revoke all on function public.record_fleet_job_journeys() from public,anon,authenticated;
grant execute on function public.record_fleet_job_journeys() to service_role;
create trigger fleet_job_journey_points after insert on public.fleet_tracker_points
referencing new table as inserted_points for each statement execute function public.record_fleet_job_journeys();

-- Reassignment starts a new observation session, preserving old trip snapshots.
create function public.reset_fleet_dispatch_tracking()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  update public.fleet_job_trips set status='incomplete'
  where id in (select trip_id from public.fleet_dispatch_state where tracker_id=old.tracker_id) and confirmed;
  delete from public.fleet_job_trips
  where id in (select trip_id from public.fleet_dispatch_state where tracker_id=old.tracker_id) and not confirmed;
  delete from public.fleet_dispatch_state where tracker_id=old.tracker_id;
  new.enabled_at=clock_timestamp();
  return new;
end;
$$;
revoke all on function public.reset_fleet_dispatch_tracking() from public,anon,authenticated;
grant execute on function public.reset_fleet_dispatch_tracking() to service_role;
create trigger reset_fleet_dispatch_tracking before update on public.fleet_dispatch_tracking
for each row execute function public.reset_fleet_dispatch_tracking();
