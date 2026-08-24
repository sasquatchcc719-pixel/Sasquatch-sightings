-- On My Way / in_progress / other status-only updates were failing when the
-- job already overlapped another active appointment (common with unassigned
-- recurring commercial visits sharing a clock window with a tech's job).
-- Overlap enforcement is for booking/reschedule, not operational status.

create or replace function public.prevent_ai_ops_appointment_overlap()
returns trigger
language plpgsql
as $$
begin
  -- Status / notes / timestamps only — do not re-litigate schedule conflicts.
  if tg_op = 'UPDATE'
     and new.appointment_date is not distinct from old.appointment_date
     and new.start_time is not distinct from old.start_time
     and new.end_time is not distinct from old.end_time
     and new.assigned_staff_user_id is not distinct from old.assigned_staff_user_id
  then
    return new;
  end if;

  if new.booking_channel not in ('ai_agent', 'sms_harry', 'lsa_sms', 'retell_rabecca', 'website') then
    return new;
  end if;

  if new.status not in ('booked', 'confirmed', 'on_my_way', 'in_progress', 'pending_approval') then
    return new;
  end if;

  if exists (
    select 1
    from public.ops_appointments existing
    where existing.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and existing.appointment_date = new.appointment_date
      and existing.status in ('booked', 'confirmed', 'on_my_way', 'in_progress', 'pending_approval')
      and (
        existing.assigned_staff_user_id is null
        or new.assigned_staff_user_id is null
        or existing.assigned_staff_user_id = new.assigned_staff_user_id
      )
      and new.start_time < existing.end_time
      and new.end_time > existing.start_time
  ) then
    raise exception 'Appointment overlaps an active appointment for that staff schedule. Check live availability before booking.'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.ops_calendar_events event
    where event.event_kind = 'block'
      and event.start_date <= new.appointment_date
      and event.end_date >= new.appointment_date
      and (
        event.assigned_staff_user_id is null
        or new.assigned_staff_user_id is null
        or event.assigned_staff_user_id = new.assigned_staff_user_id
        or event.assigned_staff_user_id = (
          select staff.user_id
          from public.staff_users staff
          where staff.id = new.assigned_staff_user_id
        )
      )
      and new.start_time < case
        when event.is_all_day or event.end_time is null then time '23:59:00'
        else event.end_time
      end
      and new.end_time > case
        when event.is_all_day or event.start_time is null then time '00:00:00'
        else event.start_time
      end
  ) then
    raise exception 'Appointment overlaps blocked schedule time for that staff schedule. Check live availability before booking.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
