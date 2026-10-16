-- Keep blacklist protection for new/reactivated bookings while allowing the
-- authenticated admin route to move an existing active job without removing
-- the customer from the blacklist.
create or replace function public.prevent_blacklisted_appointment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text;
begin
  -- Preserve historical records and let staff cancel or complete existing work.
  if new.status in ('cancelled', 'completed') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- This transaction-scoped setting is only enabled by service-role-only
    -- appointment RPCs below. It never permits inserts, customer reassignment,
    -- or reactivation of a cancelled/completed job.
    if current_setting('app.admin_blacklist_reschedule_override', true) = 'on'
      and new.customer_id is not distinct from old.customer_id
      and not (old.status in ('cancelled', 'completed')) then
      return new;
    end if;

    if new.customer_id is not distinct from old.customer_id
      and new.appointment_date is not distinct from old.appointment_date
      and new.start_time is not distinct from old.start_time
      and new.end_time is not distinct from old.end_time
      and not (old.status in ('cancelled', 'completed')) then
      return new;
    end if;
  end if;

  select phone into v_phone from public.ops_customers where id = new.customer_id;
  if public.is_phone_blacklisted(v_phone) then
    raise exception using
      errcode = 'P0001',
      message = 'This customer is blacklisted and cannot book appointments.';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_blacklisted_appointment() from public, anon, authenticated;

create or replace function public.admin_reschedule_blacklisted_appointment(
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
  customer_phone text;
  previous_override text;
begin
  select * into strict current_row
  from public.ops_appointments
  where id = p_appointment_id
  for update;

  if current_row.status in ('cancelled', 'completed') then
    raise exception 'Cancelled or completed appointments cannot be reactivated through the blacklist reschedule override.';
  end if;

  select phone into customer_phone
  from public.ops_customers
  where id = current_row.customer_id;

  if not public.is_phone_blacklisted(customer_phone) then
    raise exception 'The blacklist reschedule override is only for an existing blacklisted customer appointment.';
  end if;

  next_row := jsonb_populate_record(current_row, p_updates);
  if next_row.appointment_date is not distinct from current_row.appointment_date
    and next_row.start_time is not distinct from current_row.start_time
    and next_row.end_time is not distinct from current_row.end_time then
    raise exception 'The blacklist reschedule override requires a date or time change.';
  end if;

  previous_override := current_setting('app.admin_blacklist_reschedule_override', true);
  perform set_config('app.admin_blacklist_reschedule_override', 'on', true);

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

  perform set_config(
    'app.admin_blacklist_reschedule_override',
    coalesce(previous_override, ''),
    true
  );
end;
$$;

revoke all on function public.admin_reschedule_blacklisted_appointment(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_reschedule_blacklisted_appointment(uuid, jsonb)
  to service_role;

-- The existing owner/admin conflict override may also move an active
-- blacklisted job. It still cannot create or reactivate a booking.
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
  previous_blacklist_override text;
begin
  select * into strict current_row
  from public.ops_appointments
  where id = p_appointment_id
  for update;

  next_row := jsonb_populate_record(current_row, p_updates);
  previous_override := current_setting('app.admin_schedule_override', true);
  previous_blacklist_override := current_setting('app.admin_blacklist_reschedule_override', true);
  perform set_config('app.admin_schedule_override', 'on', true);
  perform set_config('app.admin_blacklist_reschedule_override', 'on', true);

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
  perform set_config(
    'app.admin_blacklist_reschedule_override',
    coalesce(previous_blacklist_override, ''),
    true
  );
end;
$$;

revoke all on function public.admin_override_appointment_schedule(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_override_appointment_schedule(uuid, jsonb)
  to service_role;
