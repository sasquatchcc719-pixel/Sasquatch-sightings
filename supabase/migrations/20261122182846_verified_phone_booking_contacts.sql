-- Phone callers prove a name, street and unit. Match common spoken variants without
-- revealing any profile details; the final write still uses the exact two verified IDs.
create function public.phone_address_match_key(value text, mode text)
returns text language sql immutable security invoker set search_path = '' as $$
  with normalized as (
    select trim(regexp_replace(lower(normalize(coalesce(value, ''), NFKC)), '[^[:alnum:]]+', ' ', 'g')) as words
  )
  select case mode
    when 'street' then (select string_agg(case token
      when 'street' then 'st' when 'avenue' then 'ave' when 'lane' then 'ln' when 'road' then 'rd'
      when 'court' then 'ct' when 'drive' then 'dr' when 'place' then 'pl' when 'boulevard' then 'blvd'
      else token end, ' ' order by ordinal) from regexp_split_to_table(words, ' ') with ordinality t(token, ordinal))
    when 'unit' then regexp_replace(words, '^(unit|apt|apartment|suite|ste) ', '')
    else words end from normalized;
$$;
revoke all on function public.phone_address_match_key(text,text) from public, anon, authenticated;
grant execute on function public.phone_address_match_key(text,text) to service_role;

-- Enumerate only profiles sharing the caller's phone, name, street and exact unit.
-- Used both for saved-email authority and active-job overlap across equivalent records.
create function public.phone_booking_location_matches(p_plan jsonb)
returns table(customer_id uuid,address_id uuid,email text)
language sql stable security invoker set search_path = '' as $$
  select c.id, a.id, nullif(lower(trim(c.email)),'')
    from public.ops_customers c join public.ops_service_addresses a on a.customer_id=c.id
   where nullif(trim(c.business_name),'') is null and not coalesce(c.is_commercial,false)
     and public.outreach_measurement_phone(c.phone) = public.outreach_measurement_phone(p_plan #>> '{customer,phone}')
     and public.phone_address_match_key(c.first_name,'name') = public.phone_address_match_key(p_plan #>> '{customer,first_name}','name')
     and public.phone_address_match_key(c.last_name,'name') = public.phone_address_match_key(p_plan #>> '{customer,last_name}','name')
     and public.phone_address_match_key(a.street_1,'street') = public.phone_address_match_key(p_plan #>> '{address,street_1}','street')
     and public.phone_address_match_key(a.street_2,'unit') = public.phone_address_match_key(p_plan #>> '{address,street_2}','unit')
     and public.phone_address_match_key(a.city,'name')=public.phone_address_match_key(p_plan #>> '{address,city}','name')
     and a.zip_code=p_plan #>> '{address,zip_code}' and upper(trim(a.state))='CO';
$$;
revoke all on function public.phone_booking_location_matches(jsonb) from public, anon, authenticated;
grant execute on function public.phone_booking_location_matches(jsonb) to service_role;

create or replace function public.mcp_create_appointment(
  p_plan jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  customer_id_value uuid;
  address_id_value uuid;
  appointment_id_value uuid;
  invoice_id_value uuid;
  phone_match public.ops_customers%rowtype;
  email_match public.ops_customers%rowtype;
  selected_customer public.ops_customers%rowtype;
  address_row public.ops_service_addresses%rowtype;
  address_created_value boolean := false;
  staff_auth_id uuid;
  appointment_date_value date := (p_plan ->> 'appointment_date')::date;
  start_time_value time := (p_plan ->> 'start_time')::time;
  end_time_value time := (p_plan ->> 'end_time')::time;
  staff_id_value uuid := (p_plan ->> 'assigned_staff_user_id')::uuid;
  customer_value jsonb := p_plan -> 'customer';
  address_value jsonb := p_plan -> 'address';
  lines_value jsonb := p_plan -> 'line_items';
  full_name_value text := trim((p_plan -> 'customer' ->> 'first_name') || ' ' || (p_plan -> 'customer' ->> 'last_name'));
  phone_value text := p_plan -> 'customer' ->> 'phone';
  email_value text := lower(p_plan -> 'customer' ->> 'email');
  status_value text := p_plan ->> 'appointment_status';
  subtotal_value numeric(10, 2) := (p_plan ->> 'subtotal')::numeric;
  discount_value numeric(10, 2) := (p_plan ->> 'discount_applied')::numeric;
  total_value numeric(10, 2) := (p_plan ->> 'total')::numeric;
  sync_status_value text := p_plan ->> 'sync_status';
begin
  if status_value not in ('booked', 'pending_approval') then raise exception 'Invalid appointment status.' using errcode = 'check_violation'; end if;
  if end_time_value <= start_time_value then raise exception 'Appointment end time must be after start time.' using errcode = 'check_violation'; end if;
  if jsonb_typeof(lines_value) <> 'array' or jsonb_array_length(lines_value) = 0 then raise exception 'At least one line item is required.' using errcode = 'check_violation'; end if;
  if sync_status_value not in ('held', 'pending') then raise exception 'Invalid sync status.' using errcode = 'check_violation'; end if;

  select staff.user_id into staff_auth_id from public.staff_users staff
  where staff.id = staff_id_value and staff.is_active = true;
  if not found then raise exception 'Choose an active technician.' using errcode = 'check_violation'; end if;
  perform pg_advisory_xact_lock(hashtextextended(staff_id_value::text || ':' || appointment_date_value::text, 0));

  if exists (
    select 1 from jsonb_array_elements(lines_value) line
    where nullif(line ->> 'service_catalog_item_id', '') is not null
      and not exists (
        select 1 from public.service_catalog_items catalog
        where catalog.id = (line ->> 'service_catalog_item_id')::uuid
          and catalog.is_active = true
          and round(catalog.base_price::numeric, 2) = round((line ->> 'unit_price')::numeric, 2)
      )
  ) then raise exception 'A service or price changed after preview; preview again.' using errcode = 'serialization_failure'; end if;

  if round((select sum((line ->> 'line_total')::numeric) from jsonb_array_elements(lines_value) line), 2) <> subtotal_value then
    raise exception 'Line totals do not match the preview subtotal.' using errcode = 'check_violation';
  end if;
  if round(subtotal_value - discount_value, 2) <> total_value then
    raise exception 'Appointment total does not match subtotal less discount.' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.ops_appointments existing
    where existing.appointment_date = appointment_date_value
      and coalesce(existing.is_subcontracted, false) = false
      and existing.status in ('booked', 'confirmed', 'on_my_way', 'in_progress', 'pending_approval')
      and (existing.assigned_staff_user_id is null or existing.assigned_staff_user_id = staff_id_value)
      and start_time_value < existing.end_time and end_time_value > existing.start_time
  ) or exists (
    select 1 from public.ops_calendar_events event
    where event.event_kind = 'block'
      and event.start_date <= appointment_date_value and event.end_date >= appointment_date_value
      and (event.assigned_staff_user_id is null or event.assigned_staff_user_id = staff_id_value or event.assigned_staff_user_id = staff_auth_id)
      and start_time_value < case when event.is_all_day or event.end_time is null then time '23:59:00' else event.end_time end
      and end_time_value > case when event.is_all_day or event.start_time is null then time '00:00:00' else event.start_time end
  ) then raise exception 'The selected technician/time is no longer available.' using errcode = 'check_violation'; end if;

  if p_plan ? 'verified_customer_id' or p_plan ? 'verified_service_address_id' then
    -- Only the phone booking server supplies both IDs after matching caller-stated details.
    customer_id_value := (p_plan ->> 'verified_customer_id')::uuid;
    address_id_value := (p_plan ->> 'verified_service_address_id')::uuid;
    if customer_id_value is null or address_id_value is null or p_actor_user_id is not null
       or (p_plan ->> 'use_saved_email') is null or coalesce(trim(email_value),'') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
       or lower(trim(email_value)) like '%@import.local'
       or public.outreach_measurement_phone(phone_value) !~ '^[0-9]{10}$'
       or address_value->>'state' is distinct from 'CO' then
      raise exception 'Both verified caller references and email authority are required';
    end if;
    select c.* into strict selected_customer from public.ops_customers c where c.id=customer_id_value for update;
    select a.* into strict address_row from public.ops_service_addresses a
      where a.id=address_id_value and a.customer_id=customer_id_value for update;
    if not exists(select from public.phone_booking_location_matches(p_plan) matched
      where matched.customer_id=customer_id_value and matched.address_id=address_id_value) then
      raise exception 'Verified customer or location changed';
    end if;
    -- A caller can authorize an existing email without speaking it only if all equivalent
    -- records agree. Never infer a sibling's email from a shared phone or address.
    if (p_plan ->> 'use_saved_email')::boolean and (
       lower(trim(selected_customer.email)) is distinct from lower(trim(email_value))
       or exists(select from public.phone_booking_location_matches(p_plan) matched
         where matched.email is distinct from lower(trim(email_value)))) then
      raise exception 'Saved email or location requires caller confirmation';
    end if;
    if nullif(trim(selected_customer.email),'') is not null and lower(trim(selected_customer.email)) not like '%@import.local' then
      if lower(trim(selected_customer.email)) <> lower(trim(email_value)) then raise exception 'Customer email changed'; end if;
    else
      if exists(select from public.ops_customers c where c.id <> customer_id_value and lower(trim(c.email))=lower(trim(email_value))) then
        raise exception 'New email already belongs to another customer';
      end if;
      update public.ops_customers set email=lower(trim(email_value)), updated_at=now() where id=customer_id_value;
    end if;
  else
    select customer.* into phone_match from public.ops_customers customer
    where right(regexp_replace(coalesce(customer.phone, ''), '\\D', '', 'g'), 10) = right(regexp_replace(phone_value, '\\D', '', 'g'), 10)
    order by customer.updated_at desc nulls last limit 1 for update;
    select customer.* into email_match from public.ops_customers customer
    where lower(coalesce(customer.email, '')) = email_value
    order by customer.updated_at desc nulls last limit 1 for update;

    if phone_match.id is not null
       and phone_match.business_name is not null
       and lower(trim(coalesce(phone_match.full_name, phone_match.business_name))) <> lower(full_name_value)
       and lower(coalesce(phone_match.email, '')) <> email_value then
      selected_customer := email_match;
    elsif phone_match.id is not null then
      selected_customer := phone_match;
    else
      selected_customer := email_match;
    end if;

    if selected_customer.id is null then
      insert into public.ops_customers (first_name, last_name, full_name, email, phone)
      values (customer_value ->> 'first_name', customer_value ->> 'last_name', full_name_value, email_value, phone_value)
      returning id into customer_id_value;
    else
      customer_id_value := selected_customer.id;
      update public.ops_customers set
        first_name = customer_value ->> 'first_name',
        last_name = customer_value ->> 'last_name',
        full_name = full_name_value,
        email = email_value,
        phone = phone_value,
        updated_at = now()
      where id = customer_id_value;
    end if;

    select address.* into address_row from public.ops_service_addresses address
    where address.customer_id = customer_id_value
      and lower(trim(address.street_1)) = lower(trim(address_value ->> 'street_1'))
      and regexp_replace(coalesce(address.zip_code, ''), '\\D', '', 'g') = regexp_replace(coalesce(address_value ->> 'zip_code', ''), '\\D', '', 'g')
    order by address.updated_at desc nulls last limit 1 for update;
    if address_row.id is null then
      address_created_value := true;
      insert into public.ops_service_addresses (
        customer_id, label, street_1, street_2, city, town_slug, state, zip_code
      ) values (
        customer_id_value, 'Service Address', address_value ->> 'street_1',
        nullif(address_value ->> 'street_2', ''), address_value ->> 'city',
        nullif(address_value ->> 'town_slug', ''), address_value ->> 'state', address_value ->> 'zip_code'
      ) returning id into address_id_value;
    else
      address_id_value := address_row.id;
      update public.ops_service_addresses set
        street_2 = nullif(address_value ->> 'street_2', ''),
        city = address_value ->> 'city',
        town_slug = nullif(address_value ->> 'town_slug', ''),
        state = address_value ->> 'state',
        zip_code = address_value ->> 'zip_code',
        updated_at = now()
      where id = address_id_value;
    end if;
  end if;

  insert into public.ops_appointments (
    customer_id, service_address_id, appointment_date, start_time, end_time,
    assigned_staff_user_id, status, payment_status, quoted_total, booking_channel,
    source, kind, quickbooks_sync_status, lead_source, lead_source_key,
    lead_source_detail, original_lead_source
  ) values (
    customer_id_value, address_id_value, appointment_date_value, start_time_value,
    end_time_value, staff_id_value, status_value, 'unpaid', total_value, 'ai_agent',
    'Dot MCP', 'service', sync_status_value, p_plan -> 'lead_source' ->> 'lead_source',
    p_plan -> 'lead_source' ->> 'lead_source_key', p_plan -> 'lead_source' ->> 'lead_source_detail',
    p_plan -> 'lead_source' ->> 'original_lead_source'
  ) returning id into appointment_id_value;

  insert into public.ops_appointment_line_items (
    appointment_id, service_catalog_item_id, name_snapshot, quantity, unit_price,
    duration_minutes, buffer_minutes, line_total, pricing_unit_snapshot
  ) select appointment_id_value, nullif(line ->> 'service_catalog_item_id', '')::uuid,
    line ->> 'name_snapshot', (line ->> 'quantity')::numeric,
    (line ->> 'unit_price')::numeric, (line ->> 'duration_minutes')::integer, 0,
    (line ->> 'line_total')::numeric, line ->> 'pricing_unit'
  from jsonb_array_elements(lines_value) line;

  insert into public.ops_invoices (
    appointment_id, status, payment_status, subtotal, discount_amount, total, sync_status
  ) values (appointment_id_value, 'draft', 'unpaid', subtotal_value, discount_value, total_value, sync_status_value)
  returning id into invoice_id_value;

  insert into public.ops_invoice_line_items (
    invoice_id, appointment_line_item_id, description, quantity, unit_price, line_total
  ) select invoice_id_value, line.id, line.name_snapshot, line.quantity, line.unit_price, line.line_total
  from public.ops_appointment_line_items line where line.appointment_id = appointment_id_value;

  insert into public.ops_appointment_status_events (appointment_id, from_status, to_status, changed_by, notes)
  values (appointment_id_value, null, status_value, p_actor_user_id, 'Appointment created through MCP');
  insert into public.ops_invoice_status_events (invoice_id, from_status, to_status, changed_by, notes)
  values (invoice_id_value, null, 'draft', p_actor_user_id, 'Invoice created through MCP');

  return jsonb_build_object(
    'customer_id', customer_id_value, 'address_id', address_id_value,
    'address_created', address_created_value,
    'appointment_id', appointment_id_value, 'invoice_id', invoice_id_value,
    'appointment_status', status_value, 'subtotal', subtotal_value,
    'discount_applied', discount_value, 'total', total_value
  );
end;
$$;

revoke all on function public.mcp_create_appointment(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.mcp_create_appointment(jsonb, uuid) to service_role;

create or replace function public.create_phone_appointment(p_sid text, p_hash text, p_plan jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  session_row public.phone_assistant_sessions%rowtype;
  existing public.ops_appointments%rowtype;
  matched public.ops_customers%rowtype;
  match_count integer := 0;
  incoming_phone text := right(regexp_replace(p_plan #>> '{customer,phone}', '[^0-9]', '', 'g'), 10);
  incoming_email text := lower(trim(p_plan #>> '{customer,email}'));
  receipt jsonb;
  promo public.promo_codes%rowtype;
  coupon text := p_plan ->> 'coupon_code';
  discount numeric := (p_plan ->> 'discount_applied')::numeric;
  subtotal numeric := (p_plan ->> 'subtotal')::numeric;
  current_discount numeric;
begin
  select * into strict session_row from public.phone_assistant_sessions where call_sid = p_sid for update;
  if session_row.pilot or session_row.ended_at is not null or session_row.provider_call_id is null
     or (p_plan #>> '{customer,phone}') is distinct from session_row.caller_phone
     or (p_plan ->> 'appointment_status') is distinct from 'booked'
     or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid live booking session';
  end if;

  select * into existing from public.ops_appointments where phone_assistant_call_sid = p_sid;
  if found then
    if existing.phone_assistant_request_hash is distinct from p_hash or existing.status <> 'booked' then
      raise exception 'A different booking is already linked to this call';
    end if;
    return jsonb_build_object('replayed', true, 'appointment_id', existing.id, 'appointment_status', existing.status,
      'appointment_date', existing.appointment_date, 'start_time', existing.start_time, 'total', existing.quoted_total);
  end if;

  -- Serialize concurrent calls which share either identifier, including new customers.
  perform pg_advisory_xact_lock(hashtextextended('phone-booking:phone:' || incoming_phone, 0));
  perform pg_advisory_xact_lock(hashtextextended('phone-booking:email:' || incoming_email, 0));
  -- The shared writer revalidates an exact verified pair. All new/unspecified identities
  -- retain the original conflict checks, including collisions by email alone.
  if not (p_plan ? 'verified_customer_id' or p_plan ? 'verified_service_address_id') then
    for matched in
      select * from public.ops_customers c
      where right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) = incoming_phone or lower(trim(c.email)) = incoming_email
      order by id for update
    loop
      match_count := match_count + 1;
      if match_count > 1 or matched.business_name is not null
         or right(regexp_replace(coalesce(matched.phone, ''), '[^0-9]', '', 'g'), 10) is distinct from incoming_phone
         or lower(trim(coalesce(matched.first_name, ''))) is distinct from lower(trim(p_plan #>> '{customer,first_name}'))
         or lower(trim(coalesce(matched.last_name, ''))) is distinct from lower(trim(p_plan #>> '{customer,last_name}'))
         or (nullif(trim(matched.email), '') is not null and lower(trim(matched.email)) is distinct from incoming_email)
      then raise exception 'Customer details require office review'; end if;

      -- Preserve apartment/unit data when the shared writer reuses an address.
      perform from public.ops_service_addresses a where a.customer_id = matched.id
        and lower(trim(a.street_1)) = lower(trim(p_plan #>> '{address,street_1}'))
        and regexp_replace(coalesce(a.zip_code,''), '[^0-9]', '', 'g') = p_plan #>> '{address,zip_code}'
        and lower(trim(coalesce(a.street_2,''))) <> lower(trim(coalesce(p_plan #>> '{address,street_2}', '')))
        for update;
      if found then raise exception 'Service address requires office review'; end if;
    end loop;
  end if;

  if coupon is not null then
    select * into strict promo from public.promo_codes
      where promo_codes.code = coupon and active and (expires_at is null or expires_at >= now())
        and (max_uses is null or use_count < max_uses) for update;
    if coupon = 'TF35' then raise exception 'Private offer cannot be booked by phone'; end if;
    if coupon = 'NEXTDOOR35' then
      current_discount := case when (p_plan ->> 'service_subtotal')::numeric >= 300 then 35 else 0 end;
    elsif promo.discount_type = 'tiered' then
      select coalesce(max(discount_amount), 0) into current_discount from public.promo_code_tiers
        where promo_code_id = promo.id and min_spend <= subtotal;
    elsif promo.discount_type = 'percent' then
      current_discount := round(subtotal * promo.discount_amount / 100, 2);
    else
      current_discount := promo.discount_amount;
    end if;
    if least(subtotal, current_discount) is distinct from discount then raise exception 'Coupon terms changed'; end if;
    update public.promo_codes set use_count = coalesce(use_count, 0) + 1 where id = promo.id;
  elsif discount is distinct from 0 then
    raise exception 'Missing coupon for discounted booking';
  end if;

  receipt := public.mcp_create_appointment(p_plan, null);
  update public.ops_appointments set phone_assistant_call_sid = p_sid, phone_assistant_request_hash = p_hash,
    source = 'After-hours phone (Harry)' where id = (receipt ->> 'appointment_id')::uuid;
  if coupon is not null then
    update public.ops_invoices set discount_metadata = coalesce(discount_metadata, '{}'::jsonb)
      || jsonb_build_object('promo', jsonb_build_object('code', coupon, 'amount', discount))
      where id = (receipt ->> 'invoice_id')::uuid;
  end if;
  return receipt;
end;
$$;

create or replace function public.save_phone_booking(p_sid text, p_hash text, p_plan jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  session_row public.phone_assistant_sessions%rowtype;
  existing public.ops_appointments%rowtype;
  receipt jsonb;
  contact_id uuid;
  verified boolean := p_plan ? 'verified_customer_id' or p_plan ? 'verified_service_address_id';
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
       or (verified and (existing.customer_id is distinct from (p_plan ->> 'verified_customer_id')::uuid
                        or existing.service_address_id is distinct from (p_plan ->> 'verified_service_address_id')::uuid))
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
  if verified then
    contact_id := (p_plan ->> 'verified_customer_id')::uuid;
    if contact_id is null or (p_plan ->> 'verified_service_address_id') is null then
      raise exception 'Both verified caller references are required';
    end if;
  else
    select c.id into contact_id from public.ops_customers c
      where right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) = normalized_phone
      order by c.id limit 1 for update;
  end if;
  if contact_id is not null then
    if exists(select from public.ops_appointments a where
       (a.customer_id = contact_id or (verified and exists (
          select from public.phone_booking_location_matches(p_plan) matched
           where matched.customer_id=a.customer_id and matched.address_id=a.service_address_id
             and (matched.email is null or matched.email=lower(trim(p_plan #>> '{customer,email}'))))))
       and a.parked_at is null
       and a.appointment_date = (p_plan ->> 'appointment_date')::date
       and a.status in ('booked','confirmed','pending_approval','on_my_way','in_progress')
       and a.start_time < (p_plan ->> 'end_time')::time and a.end_time > (p_plan ->> 'start_time')::time) then
      raise exception 'Customer already has an overlapping appointment';
    end if;
    -- The shared writer supports exact phone equality for legacy contacts without an email.
    -- The existing identity guard still validates name, phone and email; all changes roll back on rejection.
    if not verified then
      update public.ops_customers c set phone = caller_number where c.id = contact_id and c.phone is distinct from caller_number;
    end if;
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
