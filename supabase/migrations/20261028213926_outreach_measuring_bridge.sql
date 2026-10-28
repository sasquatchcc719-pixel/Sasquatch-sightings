-- Dedicated Outreach bridge: measurement appointments only, never a service job,
-- invoice, notification, estimate-line update, or customer-contact operation.
create table public.outreach_measurement_receipts (
  operation_key uuid primary key,
  account_id uuid not null,
  request jsonb not null,
  status text not null check (status in ('confirmed', 'rejected')),
  receipt jsonb,
  code text,
  error text,
  appointment_id uuid references public.ops_appointments(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((status = 'confirmed' and receipt is not null and appointment_id is not null and code is null)
    or (status = 'rejected' and receipt is null and appointment_id is null and code is not null))
);
alter table public.outreach_measurement_receipts enable row level security;
revoke all on public.outreach_measurement_receipts from public, anon, authenticated, service_role;
grant select, insert on public.outreach_measurement_receipts to service_role;
create index outreach_measurement_receipts_account_idx on public.outreach_measurement_receipts(account_id);
create index outreach_measurement_receipts_appointment_idx on public.outreach_measurement_receipts(appointment_id);

create function public.outreach_measurement_phone(p_phone text)
returns text language sql immutable security invoker set search_path = '' as $$
  select case when length(digits) = 11 and left(digits, 1) = '1' then substr(digits, 2) else digits end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits) normalized;
$$;

-- One consistent read includes all data used by the shared calendar primitive.
-- Stable ordering makes this a conservative stale-preview token: a changed
-- record or calendar requires a new preview, even when the old slot is free.
create function public.outreach_measurement_context(p_date date, p_identity jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'customers', coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from (
      select id, full_name, business_name, email, phone, updated_at
      from public.ops_customers
      where (p_identity->>'customer_id' is not null and id = (p_identity->>'customer_id')::uuid)
         or (p_identity->>'mode' = 'new_customer' and (
           (nullif(p_identity->'customer'->>'email', '') is not null and lower(trim(email)) = lower(trim(p_identity->'customer'->>'email')))
           or (public.outreach_measurement_phone(p_identity->'customer'->>'phone') <> '' and public.outreach_measurement_phone(phone) = public.outreach_measurement_phone(p_identity->'customer'->>'phone'))
         )) order by id limit 21
    ) c), '[]'::jsonb),
    'sites', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from (
      select id, customer_id, street_1, street_2, city, state, zip_code, updated_at
      from public.ops_service_addresses
      where p_identity->>'customer_id' is not null and customer_id = (p_identity->>'customer_id')::uuid
      order by id
    ) a), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(to_jsonb(s) order by s.scheduling_priority, s.id) from (
      select id, user_id, display_name, default_open, scheduling_priority
      from public.staff_users where is_active = true and show_on_calendar = true
    ) s), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(to_jsonb(d) order by d.staff_user_id) from (
      select staff_user_id, is_open from public.staff_daily_availability where date = p_date
    ) d), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from (
      select id, staff_user_id, day_of_week, start_time, end_time, slot_interval_minutes, is_active
      from public.availability_templates where is_active = true
    ) t), '[]'::jsonb),
    'overrides', coalesce((select jsonb_agg(to_jsonb(o) order by o.id) from (
      select id, staff_user_id, override_date, start_time, end_time, is_available
      from public.availability_overrides where override_date = p_date
    ) o), '[]'::jsonb),
    'appointments', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from (
      select id, appointment_date, start_time, end_time, status, assigned_staff_user_id
      from public.ops_appointments where appointment_date = p_date
        and coalesce(is_subcontracted, false) = false
        and status in ('booked', 'confirmed', 'on_my_way', 'in_progress', 'completed', 'pending_approval')
    ) a), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from (
      select id, event_kind, start_date, end_date, start_time, end_time, is_all_day, assigned_staff_user_id
      from public.ops_calendar_events where start_date <= p_date and end_date >= p_date and (event_kind = 'block' or event_kind is null)
    ) e), '[]'::jsonb),
    'blacklisted', exists(select 1 from public.blacklist b where public.outreach_measurement_phone(b.phone) <> '' and (
      public.outreach_measurement_phone(b.phone) = public.outreach_measurement_phone(p_identity->'customer'->>'phone')
      or exists(select 1 from public.ops_customers c where c.id = nullif(p_identity->>'customer_id', '')::uuid and public.outreach_measurement_phone(c.phone) = public.outreach_measurement_phone(b.phone))
    ))
  );
$$;

create function public.preview_outreach_measurement_context(p_date date, p_identity jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('context', context, 'version', encode(sha256(convert_to(context::text, 'UTF8')), 'hex'))
  from (select public.outreach_measurement_context(p_date, p_identity) context) snapshot;
$$;

create function public.confirm_outreach_measurement(p_input jsonb, p_expected_version text, p_expires_at timestamptz, p_writes_enabled boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  saved public.outreach_measurement_receipts%rowtype;
  identity_value jsonb := p_input->'identity';
  context_value jsonb;
  customer_value jsonb;
  site_value jsonb;
  customer_id_value uuid;
  address_id_value uuid;
  appointment_id_value uuid;
  operation_value uuid := (p_input->>'operation_key')::uuid;
  account_value uuid := (p_input->>'account_id')::uuid;
  staff_value uuid := (p_input->>'assigned_staff_user_id')::uuid;
  date_value date := (p_input->>'appointment_date')::date;
  start_value time := (p_input->>'start_time')::time;
  duration_value integer := (p_input->>'visit_duration_minutes')::integer;
  calendar_value integer;
  end_value time;
  receipt_value jsonb;
begin
  perform set_config('lock_timeout', '5s', true);
  perform pg_advisory_xact_lock(hashtextextended('outreach-measurement:' || operation_value::text, 0));
  select * into saved from public.outreach_measurement_receipts where operation_key = operation_value;
  if found then
    if saved.request <> p_input then raise exception 'Operation key belongs to a different request' using errcode = 'unique_violation'; end if;
    return case when saved.status = 'confirmed' then jsonb_build_object('status', 'confirmed', 'receipt', saved.receipt)
      else jsonb_build_object('status', 'rejected', 'receipt', null, 'code', saved.code, 'error', saved.error, 'definitive', true) end;
  end if;
  -- An exception in this nested block rolls back every business write while
  -- retaining the outer operation lock; the rejected tombstone then commits.
  begin
  if p_expires_at is null or p_expires_at <= clock_timestamp() then raise exception 'Preview expired; preview again' using errcode = 'P0001'; end if;
  if p_writes_enabled is distinct from true then raise exception 'Measuring appointment creation is disabled during testing' using errcode = 'P0001'; end if;
  if operation_value is null or account_value is null or staff_value is null
    or duration_value is null or duration_value < 15 or duration_value > 180
    or length(trim(coalesce(p_input->>'job_description', ''))) not between 1 and 5000
    or coalesce(identity_value->>'mode', '') not in ('existing', 'new_site', 'new_customer')
    or date_value < (now() at time zone 'America/Denver')::date
    or date_value > (now() at time zone 'America/Denver')::date + 366
    or (date_value = (now() at time zone 'America/Denver')::date and start_value <= (now() at time zone 'America/Denver')::time)
  then raise exception 'Invalid measurement request' using errcode = 'check_violation'; end if;
  calendar_value := least(240, duration_value + 60);
  if date_value + start_value + make_interval(mins => calendar_value) >= date_value + interval '1 day' then raise exception 'Visit must end the same day' using errcode = 'check_violation'; end if;
  end_value := start_value + make_interval(mins => calendar_value);

  perform pg_advisory_xact_lock(hashtextextended('outreach-measurement-account:' || account_value::text, 0));
  if exists(select 1 from public.outreach_measurement_receipts r join public.ops_appointments a on a.id = r.appointment_id
    where r.account_id = account_value and a.status in ('booked', 'confirmed', 'on_my_way', 'in_progress', 'pending_approval')) then
    raise exception 'This Outreach account already has an active measuring appointment; recover its saved receipt' using errcode = 'unique_violation';
  end if;

  -- Share the low-level staff/date mutex used by conversion and recurring jobs.
  -- Short table locks also cover manual/admin writers that do not take that
  -- mutex, and keep the context comparison + appointment insert indivisible.
  perform pg_advisory_xact_lock(hashtextextended(staff_value::text || ':' || date_value::text, 0));
  lock table public.ops_appointments in share row exclusive mode;
  lock table public.ops_calendar_events, public.staff_users, public.staff_daily_availability,
    public.availability_templates, public.availability_overrides, public.blacklist in share mode;
  lock table public.ops_customers, public.ops_service_addresses in share row exclusive mode;
  context_value := public.outreach_measurement_context(date_value, identity_value);
  if encode(sha256(convert_to(context_value::text, 'UTF8')), 'hex') is distinct from p_expected_version then
    raise exception 'Records or calendar changed; preview again' using errcode = 'serialization_failure';
  end if;
  if (context_value->>'blacklisted')::boolean then raise exception 'Customer is blacklisted' using errcode = 'check_violation'; end if;
  if not exists(select 1 from jsonb_array_elements(context_value->'staff') s where (s->>'id')::uuid = staff_value and coalesce(
    (select (d->>'is_open')::boolean from jsonb_array_elements(context_value->'daily') d where d->>'staff_user_id' = s->>'id'), (s->>'default_open')::boolean
  )) then raise exception 'Technician is not open' using errcode = 'check_violation'; end if;

  if exists(select 1 from public.ops_appointments a where a.appointment_date = date_value
    and coalesce(a.is_subcontracted, false) = false
    and a.status in ('booked', 'confirmed', 'on_my_way', 'in_progress', 'completed', 'pending_approval')
    and (a.assigned_staff_user_id is null or a.assigned_staff_user_id = staff_value)
    and start_value < a.end_time and end_value > a.start_time) then
    raise exception 'Measuring time overlaps existing work' using errcode = 'check_violation';
  end if;
  if exists(select 1 from public.ops_calendar_events e where (e.event_kind = 'block' or e.event_kind is null)
    and e.start_date <= date_value and e.end_date >= date_value
    and (e.assigned_staff_user_id is null or e.assigned_staff_user_id = staff_value or e.assigned_staff_user_id = (
      select s.user_id from public.staff_users s where s.id = staff_value))
    and start_value < case when e.is_all_day or e.end_time is null or date_value < e.end_date then time '23:59:59' else e.end_time end
    and end_value > case when e.is_all_day or e.start_time is null or date_value > e.start_date then time '00:00' else e.start_time end) then
    raise exception 'Measuring time overlaps a calendar block' using errcode = 'check_violation';
  end if;

  if identity_value->>'mode' = 'new_customer' then
    if jsonb_array_length(context_value->'customers') <> 0 then raise exception 'Matching customer requires explicit selection' using errcode = 'unique_violation'; end if;
    customer_value := identity_value->'customer';
    if length(trim(coalesce(customer_value->>'business_name', ''))) not between 1 and 300
      or length(trim(coalesce(customer_value->>'contact_name', ''))) not between 1 and 200
      or length(public.outreach_measurement_phone(customer_value->>'phone')) < 10
    then raise exception 'Business, contact and valid phone are required' using errcode = 'check_violation'; end if;
    insert into public.ops_customers(full_name, business_name, email, phone, is_commercial)
    values(customer_value->>'contact_name', customer_value->>'business_name', nullif(customer_value->>'email', ''), customer_value->>'phone', true)
    returning id into customer_id_value;
  else
    customer_id_value := (identity_value->>'customer_id')::uuid;
    select c into customer_value from jsonb_array_elements(context_value->'customers') c where (c->>'id')::uuid = customer_id_value;
    if customer_value is null then raise exception 'Customer no longer exists' using errcode = 'no_data_found'; end if;
  end if;
  if identity_value->>'mode' = 'existing' then
    address_id_value := (identity_value->>'service_address_id')::uuid;
    if not exists(select 1 from jsonb_array_elements(context_value->'sites') a where (a->>'id')::uuid = address_id_value and (a->>'customer_id')::uuid = customer_id_value) then
      raise exception 'Site does not belong to the selected customer' using errcode = 'check_violation';
    end if;
  else
    site_value := identity_value->'site';
    if length(trim(coalesce(site_value->>'street_1', ''))) not between 1 and 300
      or length(trim(coalesce(site_value->>'city', ''))) not between 1 and 150
      or coalesce(site_value->>'state', '') !~ '^[A-Z]{2}$'
      or coalesce(site_value->>'zip_code', '') !~ '^[0-9]{5}(-[0-9]{4})?$'
    then raise exception 'Complete site address is required' using errcode = 'check_violation'; end if;
    if exists(select 1 from public.ops_service_addresses a where a.customer_id = customer_id_value
      and lower(trim(a.street_1)) = lower(trim(site_value->>'street_1'))
      and lower(trim(coalesce(a.street_2, ''))) = lower(trim(coalesce(site_value->>'street_2', '')))
      and a.zip_code = site_value->>'zip_code') then
      raise exception 'Matching site requires explicit selection' using errcode = 'unique_violation';
    end if;
    insert into public.ops_service_addresses(customer_id, label, street_1, street_2, city, state, zip_code)
    values(customer_id_value, 'Commercial measuring visit', site_value->>'street_1', nullif(site_value->>'street_2', ''), site_value->>'city', site_value->>'state', site_value->>'zip_code')
    returning id into address_id_value;
  end if;

  insert into public.ops_appointments(customer_id, service_address_id, appointment_date, start_time, end_time,
    assigned_staff_user_id, status, payment_status, booking_channel, source, kind, estimate_status,
    quickbooks_sync_status, quoted_total, internal_notes, lead_source)
  values(customer_id_value, address_id_value, date_value, start_value, end_value, staff_value, 'confirmed', 'unpaid',
    'ai_agent', 'Outreach measuring bridge', 'estimate', 'draft', 'held', 0,
    'Outreach account ' || account_value::text || E'\nMeasuring visit: ' || (p_input->>'job_description') || E'\nNo customer notification sent.', 'Commercial')
  returning id into appointment_id_value;
  insert into public.ops_appointment_status_events(appointment_id, from_status, to_status, notes)
  values(appointment_id_value, null, 'confirmed', 'Measuring visit via Outreach; no customer notifications. Operation ' || operation_value::text);
  receipt_value := jsonb_build_object('operation_key', operation_value, 'account_id', account_value,
    'appointment_id', appointment_id_value, 'customer_id', customer_id_value, 'service_address_id', address_id_value,
    'assigned_staff_user_id', staff_value, 'appointment_date', date_value, 'start_time', to_char(start_value, 'HH24:MI'), 'end_time', to_char(end_value, 'HH24:MI'),
    'visit_duration_minutes', duration_value, 'calendar_duration_minutes', calendar_value,
    'confirmation_number', 'EST-' || upper(left(appointment_id_value::text, 8)),
    'app_url', 'https://sightings.sasquatchcarpet.com/admin/operations/estimates/' || appointment_id_value::text,
    'email_sent', false, 'sms_sent', false, 'invoice_created', false);
  insert into public.outreach_measurement_receipts(operation_key, account_id, request, status, receipt, appointment_id)
  values(operation_value, account_value, p_input, 'confirmed', receipt_value, appointment_id_value);
  return jsonb_build_object('status', 'confirmed', 'receipt', receipt_value);
  exception when others then
    insert into public.outreach_measurement_receipts(operation_key, account_id, request, status, code, error)
    values(operation_value, account_value, p_input, 'rejected',
      case when sqlstate = '40001' then 'STALE_PREVIEW' when sqlstate = '23505' then 'EXPLICIT_SELECTION_REQUIRED' else 'CONFIRM_REJECTED' end,
      case when sqlstate = 'P0001' then sqlerrm when sqlstate = '40001' then 'Records or calendar changed; preview again'
        when sqlstate = '23505' then 'Existing customer, site, or measuring visit requires explicit review' else 'Measuring request rejected; review the details and preview again' end)
    returning * into saved;
    return jsonb_build_object('status', 'rejected', 'receipt', null, 'code', saved.code, 'error', saved.error, 'definitive', true);
  end;
end;
$$;
revoke all on function public.outreach_measurement_phone(text), public.outreach_measurement_context(date,jsonb),
  public.preview_outreach_measurement_context(date,jsonb), public.confirm_outreach_measurement(jsonb,text,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.outreach_measurement_phone(text), public.outreach_measurement_context(date,jsonb),
  public.preview_outreach_measurement_context(date,jsonb), public.confirm_outreach_measurement(jsonb,text,timestamptz,boolean) to service_role;
