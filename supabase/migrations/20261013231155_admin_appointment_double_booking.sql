-- Keep automatic/public booking guards; allow an explicit staff admin override
-- without changing the appointment's original booking channel.
create or replace function public.prevent_ai_ops_appointment_overlap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Only the server's transaction-scoped admin override may bypass conflicts.
  if current_user = 'service_role'
     and current_setting('app.admin_schedule_override', true) = 'on'
  then
    return new;
  end if;

  -- Status / notes / timestamps only — do not re-litigate schedule conflicts.
  if tg_op = 'UPDATE'
     and new.appointment_date is not distinct from old.appointment_date
     and new.start_time is not distinct from old.start_time
     and new.end_time is not distinct from old.end_time
     and new.assigned_staff_user_id is not distinct from old.assigned_staff_user_id
  then
    return new;
  end if;

  -- Outside crews do not occupy our schedule.
  if coalesce(new.is_subcontracted, false) then
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
    raise exception 'Appointment overlaps blocked schedule time for that staff schedule. Check live availability before booking.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function public.admin_override_appointment_schedule(
  p_appointment_id uuid,
  p_updates jsonb
)
returns setof public.ops_appointments
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_row public.ops_appointments;
  next_row public.ops_appointments;
  previous_override text;
begin
  select * into strict current_row
  from public.ops_appointments
  where id = p_appointment_id
  for update;

  next_row := jsonb_populate_record(current_row, p_updates);
  previous_override := current_setting('app.admin_schedule_override', true);
  perform set_config('app.admin_schedule_override', 'on', true);

  return query
  update public.ops_appointments
  set
    appointment_date = next_row.appointment_date,
    start_time = next_row.start_time,
    end_time = next_row.end_time,
    status = next_row.status,
    payment_status = next_row.payment_status,
    parked_at = next_row.parked_at,
    internal_notes = next_row.internal_notes,
    lead_source = next_row.lead_source,
    lead_source_key = next_row.lead_source_key,
    lead_source_detail = next_row.lead_source_detail,
    original_lead_source = next_row.original_lead_source,
    assigned_staff_user_id = next_row.assigned_staff_user_id,
    on_my_way_at = next_row.on_my_way_at,
    completed_at = next_row.completed_at,
    updated_at = next_row.updated_at,
    recurring_template_id = next_row.recurring_template_id
  where id = p_appointment_id
  returning *;

  perform set_config('app.admin_schedule_override', coalesce(previous_override, ''), true);
end;
$$;

revoke all on function public.admin_override_appointment_schedule(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_override_appointment_schedule(uuid, jsonb)
  to service_role;
