create function public.create_phone_measurement(p_sid text, p_hash text, p_plan jsonb, p_version text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  call_row public.phone_assistant_sessions%rowtype;
  job public.ops_appointments%rowtype;
  customer public.ops_customers%rowtype;
  contact jsonb := p_plan->'customer';
  site jsonb := p_plan->'address';
  company text := trim(contact->>'business_name');
  contact_name text := trim(concat_ws(' ',contact->>'first_name',contact->>'last_name'));
  email_value text := lower(trim(contact->>'email'));
  phone_value text := public.outreach_measurement_phone(contact->>'phone');
  staff_id uuid := (p_plan->>'staff_id')::uuid;
  service_day date := (p_plan->>'date')::date;
  arrival time := (p_plan->>'time')::time;
  finish time := arrival + interval '2 hours';
  address_id uuid;
  created boolean := false;
  caller_sequence integer;
begin
  perform set_config('lock_timeout','5s',true);
  select * into strict call_row from public.phone_assistant_sessions where call_sid=p_sid for update;
  if call_row.pilot or call_row.answered_at is null or call_row.provider_call_id is null
    or call_row.caller_phone is distinct from contact->>'phone'
    or coalesce(p_hash,'') !~ '^[0-9a-f]{64}$' then raise exception 'Invalid live call'; end if;

  select * into job from public.ops_appointments where phone_assistant_call_sid=p_sid;
  if found then
    if job.kind is distinct from 'estimate' or job.phone_assistant_request_hash is distinct from p_hash
      or job.status not in ('confirmed','booked') or job.parked_at is not null or job.appointment_date is distinct from service_day
      or job.start_time is distinct from arrival then raise exception 'Check the visit already linked to this call'; end if;
  else
    if call_row.ended_at is not null then raise exception 'Call is inactive'; end if;
    if p_plan ? 'expected_caller_sequence' then
      select max(sequence) into caller_sequence from public.phone_assistant_transcript where call_sid=p_sid and role='user';
      if caller_sequence is distinct from (p_plan->>'expected_caller_sequence')::integer then raise exception 'Caller turn changed'; end if;
    end if;
    if nullif(company,'') is null or nullif(contact_name,'') is null or nullif(email_value,'') is null
      or length(phone_value) is distinct from 10 or nullif(trim(p_plan->>'description'),'') is null
      or nullif(trim(site->>'street_1'),'') is null or nullif(trim(site->>'city'),'') is null
      or site->>'state' is distinct from 'CO' or coalesce(site->>'zip_code','') !~ '^[0-9]{5}$'
      or arrival is null or finish <= arrival or service_day + arrival <= now() at time zone 'America/Denver'
      then raise exception 'Incomplete or expired measuring request'; end if;

    -- Keep manual schedule, calendar block and identity edits from changing the
    -- facts checked by the slot picker while the zero-dollar visit is saved.
    perform public.lock_phone_booking_calendar(service_day,staff_id,contact,p_version);
    if exists(select from public.blacklist where public.outreach_measurement_phone(phone)=phone_value) then
      raise exception 'Booking unavailable';
    end if;

    -- Never merge contacts or overwrite an existing company from caller input.
    begin
      select * into strict customer from public.ops_customers c
        where public.outreach_measurement_phone(c.phone)=phone_value or lower(trim(c.email))=email_value;
      if public.outreach_measurement_phone(customer.phone) is distinct from phone_value
        or lower(trim(customer.full_name)) is distinct from lower(contact_name)
        or lower(trim(customer.business_name)) is distinct from lower(company)
        or (nullif(trim(customer.email),'') is not null and lower(trim(customer.email)) is distinct from email_value)
        then raise exception 'Customer details require office review'; end if;
    exception when no_data_found then
      insert into public.ops_customers(first_name,last_name,full_name,business_name,phone,email,is_commercial)
        values(contact->>'first_name',contact->>'last_name',contact_name,company,contact->>'phone',email_value,true)
        returning * into customer;
    end;
    select a.id into address_id from public.ops_service_addresses a where a.customer_id=customer.id
      and lower(trim(a.street_1))=lower(trim(site->>'street_1'))
      and lower(trim(coalesce(a.street_2,'')))=lower(trim(coalesce(site->>'street_2','')))
      and lower(trim(a.city))=lower(trim(site->>'city')) and upper(trim(a.state))=site->>'state' and a.zip_code=site->>'zip_code'
      order by a.id limit 1;
    if address_id is null then
      insert into public.ops_service_addresses(customer_id,label,street_1,street_2,city,state,zip_code,town_slug)
      values(customer.id,'Walkthrough Address',site->>'street_1',nullif(site->>'street_2',''),site->>'city',site->>'state',
        site->>'zip_code',site->>'town_slug') returning id into address_id;
    end if;
    if exists(select from public.ops_appointments a where a.service_address_id=address_id and a.kind='estimate'
      and a.status in ('confirmed','booked','scheduled') and a.parked_at is null and a.appointment_date >= (now() at time zone 'America/Denver')::date)
      then raise exception 'A measuring visit is already scheduled at this site'; end if;
    insert into public.ops_appointments(customer_id,service_address_id,appointment_date,start_time,end_time,assigned_staff_user_id,
      status,payment_status,quickbooks_sync_status,kind,estimate_status,quoted_total,booking_channel,source,internal_notes,
      phone_assistant_call_sid,phone_assistant_request_hash,lead_source,lead_source_key,lead_source_detail,original_lead_source)
      values(customer.id,address_id,service_day,arrival,finish,staff_id,'confirmed','unpaid','held','estimate','draft',0,
        'ai_agent','After-hours phone (Harry)',p_plan->>'description',p_sid,p_hash,p_plan#>>'{source,lead_source}',
        p_plan#>>'{source,lead_source_key}',p_plan#>>'{source,lead_source_detail}',p_plan#>>'{source,original_lead_source}')
      returning * into job;
    created := true;
    insert into public.ops_appointment_status_events(appointment_id,to_status,notes)
      values(job.id,'confirmed','Commercial measuring visit scheduled by Harry on the inbound call.');
  end if;
  return jsonb_build_object('status','booked','created',created,'address_id',job.service_address_id,'appointment_id',job.id,'confirmation_number','EST-' || upper(left(job.id::text,8)),
    'date',job.appointment_date,'time',to_char(job.start_time,'HH24:MI'));
end;
$$;

revoke all on function public.create_phone_measurement(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_phone_measurement(text,text,jsonb,text) to service_role;
