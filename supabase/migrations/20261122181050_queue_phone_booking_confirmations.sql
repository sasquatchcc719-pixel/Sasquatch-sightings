-- Keep the old entry point for in-flight calls during rollout. Only this writer
-- queues confirmation mail; old deployments still deliver it directly.
create function public.save_phone_booking(p_sid text, p_hash text, p_plan jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  session_row public.phone_assistant_sessions%rowtype;
  existing public.ops_appointments%rowtype;
  receipt jsonb;
  contact_id uuid;
  caller_number text := p_plan #>> '{customer,phone}';
  normalized_phone text := right(regexp_replace(caller_number, '[^0-9]', '', 'g'), 10);
  email text := lower(trim(p_plan #>> '{customer,email}'));
  expected_sequence integer := (p_plan ->> 'expected_caller_sequence')::integer;
  actual_sequence integer;
  service_subtotal numeric;
begin
  select * into strict session_row from public.phone_assistant_sessions where call_sid = p_sid for update;
  if session_row.pilot or session_row.answered_at is null or session_row.provider_call_id is null
     or caller_number is distinct from session_row.caller_phone or length(normalized_phone) <> 10
     or nullif(email, '') is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid live booking session';
  end if;

  select * into existing from public.ops_appointments where phone_assistant_call_sid = p_sid;
  if found then
    if existing.phone_assistant_request_hash is distinct from p_hash or existing.status not in ('booked','confirmed')
       or existing.parked_at is not null or existing.appointment_date is distinct from (p_plan ->> 'appointment_date')::date
       or existing.start_time is distinct from (p_plan ->> 'start_time')::time
       or existing.quoted_total is distinct from (p_plan ->> 'total')::numeric then
      raise exception 'Existing call booking requires review';
    end if;
    return jsonb_build_object('replayed', true, 'appointment_id', existing.id, 'appointment_status', 'booked',
      'appointment_date', existing.appointment_date, 'start_time', existing.start_time, 'total', existing.quoted_total);
  end if;
  if session_row.ended_at is not null then raise exception 'Call is inactive'; end if;
  if p_plan ? 'expected_caller_sequence' then
    select max(sequence) into actual_sequence from public.phone_assistant_transcript where call_sid = p_sid and role = 'user';
    if actual_sequence is distinct from expected_sequence then raise exception 'The caller has spoken again'; end if;
  end if;

  perform public.lock_phone_booking_calendar((p_plan ->> 'appointment_date')::date,
    (p_plan ->> 'assigned_staff_user_id')::uuid, p_plan -> 'customer', p_plan ->> 'calendar_version');
  perform pg_advisory_xact_lock(hashtextextended('phone-booking:phone:' || normalized_phone, 0));
  perform pg_advisory_xact_lock(hashtextextended('phone-booking:email:' || email, 0));
  select c.id into contact_id from public.ops_customers c
    where right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) = normalized_phone
    order by c.id limit 1 for update;
  if contact_id is not null then
    if exists(select from public.ops_appointments a where a.customer_id = contact_id and a.parked_at is null
       and a.appointment_date = (p_plan ->> 'appointment_date')::date
       and a.status in ('booked','confirmed','pending_approval','on_my_way','in_progress')
       and a.start_time < (p_plan ->> 'end_time')::time and a.end_time > (p_plan ->> 'start_time')::time) then
      raise exception 'Customer already has an overlapping appointment';
    end if;
    -- The shared writer supports exact phone equality for legacy contacts without an email.
    -- The existing identity guard still validates name, phone and email; all changes roll back on rejection.
    update public.ops_customers c set phone = caller_number where c.id = contact_id and c.phone is distinct from caller_number;
  end if;
  select coalesce(sum((line ->> 'line_total')::numeric), 0) into service_subtotal
    from jsonb_array_elements(p_plan -> 'line_items') line where nullif(line ->> 'service_catalog_item_id','') is not null;
  if service_subtotal is distinct from (p_plan ->> 'service_subtotal')::numeric then raise exception 'Service subtotal changed'; end if;
  receipt := public.create_phone_appointment(p_sid, p_hash, p_plan);
  if contact_id is not null and contact_id <> (receipt ->> 'customer_id')::uuid then
    raise exception 'Customer match requires office review';
  end if;
  insert into public.ops_communication_queue(template_key,appointment_id,customer_id,scheduled_for,payload)
    select template_key, (receipt ->> 'appointment_id')::uuid, (receipt ->> 'customer_id')::uuid, now(),
      jsonb_build_object('origin','phone_booking','date',p_plan ->> 'appointment_date','time',p_plan ->> 'start_time',
        'total',p_plan -> 'total','to',email)
    from public.ops_communication_templates where template_key = 'job_scheduled_email' and is_enabled;
  select * into strict existing from public.ops_appointments where phone_assistant_call_sid = p_sid;
  if existing.id <> (receipt ->> 'appointment_id')::uuid or existing.status <> 'booked' or existing.parked_at is not null
     or existing.appointment_date is distinct from (p_plan ->> 'appointment_date')::date
     or existing.start_time is distinct from (p_plan ->> 'start_time')::time
     or existing.quoted_total is distinct from (p_plan ->> 'total')::numeric then raise exception 'Saved booking differs from confirmed terms'; end if;
  return receipt || jsonb_build_object('appointment_date', existing.appointment_date,'start_time',existing.start_time);
end;
$$;
revoke all on function public.save_phone_booking(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_phone_booking(text,text,jsonb) to service_role;
