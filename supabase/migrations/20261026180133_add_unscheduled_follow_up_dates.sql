-- Internal follow-up dates are separate from technician/customer appointment data.
create table public.ops_unscheduled_follow_ups (
  appointment_id uuid primary key references public.ops_appointments(id) on delete cascade,
  next_follow_up_date date not null,
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 2000),
  reviewed_by uuid references auth.users(id),
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.ops_unscheduled_follow_ups enable row level security;
revoke all on public.ops_unscheduled_follow_ups from public, anon, authenticated;
grant select, insert, update, delete on public.ops_unscheduled_follow_ups to service_role;
create index ops_unscheduled_follow_ups_due_idx
  on public.ops_unscheduled_follow_ups(next_follow_up_date) where resolved_at is null;

create function public.sync_unscheduled_follow_up() returns trigger
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
        next_follow_up_date=excluded.next_follow_up_date, reviewed_at=null,
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
revoke all on function public.sync_unscheduled_follow_up() from public, anon, authenticated;
create trigger sync_unscheduled_follow_up after insert or update of parked_at
on public.ops_appointments for each row execute function public.sync_unscheduled_follow_up();

-- Review old parked jobs now; new jobs get three days before their first review.
insert into public.ops_unscheduled_follow_ups(appointment_id,next_follow_up_date)
select id,greatest((parked_at at time zone 'America/Denver')::date + 3,
                  (now() at time zone 'America/Denver')::date)
from public.ops_appointments where parked_at is not null;
