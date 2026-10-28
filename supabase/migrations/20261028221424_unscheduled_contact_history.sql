-- Internal follow-up plans and their history stay separate from job schedules.
alter table public.ops_unscheduled_follow_ups
  add column next_follow_up_time time,
  add column updated_by uuid references auth.users(id),
  add column updated_by_label text;

create table public.ops_unscheduled_follow_up_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.ops_appointments(id) on delete cascade,
  occurred_at timestamptz not null default clock_timestamp(),
  event_type text not null check (event_type in ('plan', 'review', 'resolved', 'reopened')),
  note text,
  next_follow_up_date date not null,
  next_follow_up_time time,
  actor_id uuid references auth.users(id),
  actor_label text
);
create index ops_unscheduled_follow_up_events_appointment_idx
  on public.ops_unscheduled_follow_up_events(appointment_id, occurred_at desc);
alter table public.ops_unscheduled_follow_up_events enable row level security;
revoke all on public.ops_unscheduled_follow_up_events from public, anon, authenticated;
grant select, insert on public.ops_unscheduled_follow_up_events to service_role;

-- Preserve the latest pre-existing review, without inventing earlier activity.
insert into public.ops_unscheduled_follow_up_events
  (appointment_id, occurred_at, event_type, note, next_follow_up_date, actor_id, actor_label)
select appointment_id, coalesce(reviewed_at, updated_at),
  case when reviewed_at is null then 'plan' else 'review' end,
  case when reviewed_at is null then null else review_note end,
  next_follow_up_date, reviewed_by, 'Existing record'
from public.ops_unscheduled_follow_ups;

create function public.record_unscheduled_follow_up_event() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  kind text := 'plan';
  review_changed boolean := false;
begin
  if tg_op = 'UPDATE' then
    review_changed := new.reviewed_at is distinct from old.reviewed_at and new.reviewed_at is not null;
    if new.resolved_at is distinct from old.resolved_at and new.resolved_at is not null then
      kind := 'resolved';
    elsif old.resolved_at is not null and new.resolved_at is null then
      kind := 'reopened';
    elsif review_changed then
      kind := 'review';
    end if;
  end if;
  insert into public.ops_unscheduled_follow_up_events
    (appointment_id, occurred_at, event_type, note, next_follow_up_date,
     next_follow_up_time, actor_id, actor_label)
  values (new.appointment_id, clock_timestamp(), kind,
    case when review_changed then new.review_note else null end,
    new.next_follow_up_date, new.next_follow_up_time,
    case when kind in ('resolved','reopened') then null else new.updated_by end,
    case when kind in ('resolved','reopened') then 'Schedule change' else new.updated_by_label end);
  return new;
end;
$$;
revoke all on function public.record_unscheduled_follow_up_event() from public, anon, authenticated;
create trigger record_unscheduled_follow_up_event after insert or update
on public.ops_unscheduled_follow_ups for each row execute function public.record_unscheduled_follow_up_event();

-- A new parking cycle must not inherit a previous exact-time plan.
create or replace function public.sync_unscheduled_follow_up() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.parked_at is not null then
    if tg_op = 'INSERT' then
      insert into public.ops_unscheduled_follow_ups(appointment_id,next_follow_up_date)
      values(new.id,(new.parked_at at time zone 'America/Denver')::date + 3);
    elsif old.parked_at is null or new.parked_at is distinct from old.parked_at then
      insert into public.ops_unscheduled_follow_ups(appointment_id,next_follow_up_date)
      values(new.id,(new.parked_at at time zone 'America/Denver')::date + 3)
      on conflict(appointment_id) do update set
        next_follow_up_date=excluded.next_follow_up_date, next_follow_up_time=null, updated_by=null, updated_by_label=null, reviewed_at=null,
        review_note=null, reviewed_by=null, resolved_at=null, updated_at=clock_timestamp();
    end if;
  elsif tg_op='UPDATE' then
    if old.parked_at is not null then
      update public.ops_unscheduled_follow_ups set resolved_at=clock_timestamp(),updated_at=clock_timestamp()
      where appointment_id=new.id and resolved_at is null;
    end if;
  end if;
  return new;
end;
$$;
