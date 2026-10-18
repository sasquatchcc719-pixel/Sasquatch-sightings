-- Existing plans keep their fixed schedule unless staff choose flexible scheduling.
alter table public.ops_recurring_templates
  add column scheduling_mode text not null default 'fixed'
    check (scheduling_mode in ('fixed', 'flexible')),
  add column visit_overrides jsonb not null default '{}'::jsonb
    check (jsonb_typeof(visit_overrides) = 'object');

-- Fail closed if two generators choose the same opening or original occurrence.
-- This guard intentionally does not change ordinary manual booking behavior.
create or replace function public.prevent_flexible_recurring_appointment_conflict()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  occurrence_date date;
  assigned_auth_user_id uuid;
begin
  if new.recurring_template_id is null then
    return new;
  end if;

  -- Closing a visit or editing its notes must not re-litigate old conflicts.
  if tg_op = 'UPDATE'
     and new.appointment_date is not distinct from old.appointment_date
     and new.start_time is not distinct from old.start_time
     and new.end_time is not distinct from old.end_time
     and new.assigned_staff_user_id is not distinct from old.assigned_staff_user_id
     and new.recurring_template_id is not distinct from old.recurring_template_id
     and new.original_recurring_date is not distinct from old.original_recurring_date
  then
    return new;
  end if;

  if not exists (
    select 1 from public.ops_recurring_templates template
    where template.id = new.recurring_template_id
      and template.scheduling_mode = 'flexible'
  ) then
    return new;
  end if;

  occurrence_date := coalesce(new.original_recurring_date, new.appointment_date);
  perform pg_advisory_xact_lock(hashtextextended(
    'flexible-recurring:' || new.recurring_template_id::text || ':' || occurrence_date::text, 0
  ));

  -- A cancelled/moved occurrence still owns its original date, preventing refill.
  if exists (
    select 1 from public.ops_appointments existing
    where existing.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and existing.recurring_template_id = new.recurring_template_id
      and coalesce(existing.original_recurring_date, existing.appointment_date) = occurrence_date
  ) then
    raise exception 'This recurring occurrence already has an appointment. Refresh the plan before generating visits.'
      using errcode = 'unique_violation';
  end if;

  -- Preserve the server-only, explicit manual scheduling override.
  if current_user = 'service_role'
     and current_setting('app.admin_schedule_override', true) = 'on'
  then
    return new;
  end if;

  if coalesce(new.is_subcontracted, false)
     or new.status not in ('booked', 'confirmed', 'on_my_way', 'in_progress', 'pending_approval')
  then
    return new;
  end if;

  -- Serialize flexible plans, including unassigned work that blocks every crew.
  perform pg_advisory_xact_lock(hashtextextended(
    'flexible-recurring-day:' || new.appointment_date::text, 0
  ));
  -- Share the conversion/agent RPC staff-date lock where a technician is assigned.
  if new.assigned_staff_user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      new.assigned_staff_user_id::text || ':' || new.appointment_date::text, 0
    ));
  end if;

  if exists (
    select 1 from public.ops_appointments existing
    where existing.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and existing.appointment_date = new.appointment_date
      and coalesce(existing.is_subcontracted, false) = false
      and existing.status in ('booked', 'confirmed', 'on_my_way', 'in_progress', 'pending_approval')
      and (
        existing.assigned_staff_user_id is null
        or new.assigned_staff_user_id is null
        or existing.assigned_staff_user_id = new.assigned_staff_user_id
      )
      and new.start_time < existing.end_time
      and new.end_time > existing.start_time
  ) then
    raise exception 'Appointment overlaps an active appointment for that staff schedule. Refresh the recurring preview to find another opening.'
      using errcode = 'check_violation';
  end if;

  select staff.user_id into assigned_auth_user_id
  from public.staff_users staff
  where staff.id = new.assigned_staff_user_id;

  if exists (
    select 1 from public.ops_calendar_events event
    where event.event_kind = 'block'
      and event.start_date <= new.appointment_date
      and event.end_date >= new.appointment_date
      and (
        event.assigned_staff_user_id is null
        or new.assigned_staff_user_id is null
        or event.assigned_staff_user_id = new.assigned_staff_user_id
        or event.assigned_staff_user_id = assigned_auth_user_id
      )
      and new.start_time < case
        when event.is_all_day or event.end_time is null then time '23:59:59'
        when new.appointment_date < event.end_date then time '23:59:59'
        else event.end_time
      end
      and new.end_time > case
        when event.is_all_day or event.start_time is null then time '00:00:00'
        when new.appointment_date > event.start_date then time '00:00:00'
        else event.start_time
      end
  ) then
    raise exception 'Appointment overlaps blocked schedule time for that staff schedule. Refresh the recurring preview to find another opening.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_flexible_recurring_appointment_conflict()
  from public, anon, authenticated;
grant execute on function public.prevent_flexible_recurring_appointment_conflict()
  to service_role;

create trigger prevent_flexible_recurring_appointment_conflict_trigger
before insert or update of appointment_date, start_time, end_time,
  assigned_staff_user_id, recurring_template_id, original_recurring_date
on public.ops_appointments
for each row execute function public.prevent_flexible_recurring_appointment_conflict();
