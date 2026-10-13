-- Tracked source for the expanded Sightings MCP controls. Before applying in
-- any environment, inspect for existing objects and drift; production may have
-- received these objects outside the migration runner. This migration grants no
-- owner scope by itself.

create table if not exists public.mcp_saved_conversation_drafts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create unique index if not exists mcp_saved_conversation_drafts_active_idx
  on public.mcp_saved_conversation_drafts (conversation_id, created_by)
  where status = 'draft';

create table if not exists public.mcp_action_previews (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action_type text not null,
  action_payload jsonb not null,
  payload_hash text not null,
  preview jsonb not null,
  required_scope text not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  status text not null default 'pending'
    check (status in ('pending', 'executing', 'executed', 'cancelled', 'expired', 'failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  executed_at timestamptz,
  result jsonb,
  error_message text,
  unique (actor_user_id, action_type, idempotency_key)
);

create index if not exists mcp_action_previews_pending_idx
  on public.mcp_action_previews (actor_user_id, status, expires_at);

create table if not exists public.mcp_action_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  preview_id uuid references public.mcp_action_previews(id) on delete set null,
  action_type text not null,
  status text not null,
  target_ids jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mcp_action_audit_actor_created_idx
  on public.mcp_action_audit (actor_user_id, created_at desc);

alter table public.mcp_saved_conversation_drafts enable row level security;
alter table public.mcp_action_previews enable row level security;
alter table public.mcp_action_audit enable row level security;

revoke all on table public.mcp_saved_conversation_drafts from public, anon, authenticated;
revoke all on table public.mcp_action_previews from public, anon, authenticated;
revoke all on table public.mcp_action_audit from public, anon, authenticated;
grant select, insert, update on table public.mcp_saved_conversation_drafts to service_role;
grant select, insert, update on table public.mcp_action_previews to service_role;
grant select, insert on table public.mcp_action_audit to service_role;

comment on table public.mcp_saved_conversation_drafts is
  'Owner-only Sightings reply drafts. Saving is not sending.';
comment on table public.mcp_action_previews is
  'Short-lived, exact MCP action previews used for confirmation and idempotency.';
comment on table public.mcp_action_audit is
  'Credential-free audit trail for attempted and completed MCP business actions.';

-- Convert an estimate to a service appointment and draft invoice as one
-- database transaction. Application callers may perform QuickBooks sync and
-- lifecycle communications only after this function commits; those external
-- follow-ups never determine whether the core business records exist.
create or replace function public.mcp_convert_estimate(
  p_estimate_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_status text,
  p_appointment_date date,
  p_start_time time,
  p_end_time time,
  p_assigned_staff_user_id uuid,
  p_discount_amount numeric,
  p_actor_user_id uuid,
  p_sync_status text,
  p_allow_conflict boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  estimate_row public.ops_appointments%rowtype;
  assigned_staff record;
  service_appointment_id uuid;
  invoice_id uuid;
  source_line_count integer;
  calculated_subtotal numeric(10, 2);
  calculated_discount numeric(10, 2);
  calculated_total numeric(10, 2);
begin
  if p_end_time <= p_start_time then
    raise exception 'The conversion end time must be after its start time.'
      using errcode = 'check_violation';
  end if;
  if p_discount_amount is null or p_discount_amount < 0 then
    raise exception 'The discount amount must be zero or greater.'
      using errcode = 'check_violation';
  end if;
  if p_sync_status not in ('held', 'pending', 'synced', 'failed') then
    raise exception 'Invalid QuickBooks sync status.'
      using errcode = 'check_violation';
  end if;

  -- Serialize every conversion/reschedule that uses this technician and day.
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_assigned_staff_user_id::text || ':' || p_appointment_date::text,
      0
    )
  );

  select staff.id, staff.user_id, staff.display_name
  into assigned_staff
  from public.staff_users staff
  where staff.id = p_assigned_staff_user_id
    and staff.is_active = true;
  if not found then
    raise exception 'Choose an active technician.'
      using errcode = 'check_violation';
  end if;

  select estimate.*
  into estimate_row
  from public.ops_appointments estimate
  where estimate.id = p_estimate_id
    and estimate.kind = 'estimate'
  for update;
  if not found then
    raise exception 'Estimate not found.' using errcode = 'no_data_found';
  end if;
  if estimate_row.converted_appointment_id is not null
     or estimate_row.estimate_status = 'converted' then
    raise exception 'This estimate has already been converted.'
      using errcode = 'unique_violation';
  end if;
  if estimate_row.updated_at is distinct from p_expected_updated_at
     or coalesce(estimate_row.estimate_status, 'draft') <> p_expected_status then
    raise exception 'The estimate changed after preview; preview again.'
      using errcode = 'serialization_failure';
  end if;

  select count(*), coalesce(sum(line.line_total), 0)
  into source_line_count, calculated_subtotal
  from public.ops_appointment_line_items line
  where line.appointment_id = p_estimate_id;
  if source_line_count = 0 then
    raise exception 'Add at least one line item before converting.'
      using errcode = 'check_violation';
  end if;
  calculated_subtotal := round(calculated_subtotal, 2);
  calculated_discount := round(p_discount_amount, 2);
  calculated_total := greatest(0, calculated_subtotal - calculated_discount);

  if not p_allow_conflict and exists (
    select 1
    from public.ops_appointments existing
    where existing.appointment_date = p_appointment_date
      and coalesce(existing.is_subcontracted, false) = false
      and existing.status in (
        'booked', 'confirmed', 'on_my_way', 'in_progress', 'pending_approval'
      )
      and (
        existing.assigned_staff_user_id is null
        or existing.assigned_staff_user_id = p_assigned_staff_user_id
      )
      and p_start_time < existing.end_time
      and p_end_time > existing.start_time
  ) then
    raise exception 'That time overlaps existing work on the technician calendar.'
      using errcode = 'check_violation';
  end if;

  if not p_allow_conflict and exists (
    select 1
    from public.ops_calendar_events event
    where event.event_kind = 'block'
      and event.start_date <= p_appointment_date
      and event.end_date >= p_appointment_date
      and (
        event.assigned_staff_user_id is null
        or event.assigned_staff_user_id = p_assigned_staff_user_id
        or event.assigned_staff_user_id = assigned_staff.user_id
      )
      and p_start_time < case
        when event.is_all_day or event.end_time is null then time '23:59:00'
        else event.end_time
      end
      and p_end_time > case
        when event.is_all_day or event.start_time is null then time '00:00:00'
        else event.start_time
      end
  ) then
    raise exception 'That time overlaps blocked technician calendar time.'
      using errcode = 'check_violation';
  end if;

  insert into public.ops_appointments (
    customer_id,
    service_address_id,
    appointment_date,
    start_time,
    end_time,
    assigned_staff_user_id,
    status,
    payment_status,
    kind,
    booking_channel,
    source,
    quickbooks_sync_status,
    quoted_total,
    internal_notes,
    lead_source,
    lead_source_key,
    lead_source_detail,
    original_lead_source
  ) values (
    estimate_row.customer_id,
    estimate_row.service_address_id,
    p_appointment_date,
    p_start_time,
    p_end_time,
    p_assigned_staff_user_id,
    'booked',
    'unpaid',
    'service',
    'mcp',
    'Dot MCP',
    p_sync_status,
    calculated_total,
    estimate_row.internal_notes,
    estimate_row.lead_source,
    estimate_row.lead_source_key,
    estimate_row.lead_source_detail,
    estimate_row.original_lead_source
  )
  returning id into service_appointment_id;

  insert into public.ops_appointment_line_items (
    appointment_id,
    service_catalog_item_id,
    name_snapshot,
    notes,
    quantity,
    unit_price,
    duration_minutes,
    buffer_minutes,
    line_total,
    length_value,
    width_value,
    pricing_unit_snapshot,
    area_segments
  )
  select
    service_appointment_id,
    source.service_catalog_item_id,
    source.name_snapshot,
    source.notes,
    source.quantity,
    source.unit_price,
    source.duration_minutes,
    source.buffer_minutes,
    source.line_total,
    source.length_value,
    source.width_value,
    source.pricing_unit_snapshot,
    source.area_segments
  from public.ops_appointment_line_items source
  where source.appointment_id = p_estimate_id;

  insert into public.ops_invoices (
    appointment_id,
    status,
    payment_status,
    subtotal,
    discount_amount,
    total,
    sync_status
  ) values (
    service_appointment_id,
    'draft',
    'unpaid',
    calculated_subtotal,
    calculated_discount,
    calculated_total,
    p_sync_status
  )
  returning id into invoice_id;

  insert into public.ops_invoice_line_items (
    invoice_id,
    appointment_line_item_id,
    description,
    quantity,
    unit_price,
    line_total
  )
  select
    invoice_id,
    line.id,
    line.name_snapshot,
    line.quantity,
    line.unit_price,
    line.line_total
  from public.ops_appointment_line_items line
  where line.appointment_id = service_appointment_id;

  insert into public.ops_appointment_status_events (
    appointment_id, from_status, to_status, changed_by, notes
  ) values (
    service_appointment_id,
    null,
    'booked',
    p_actor_user_id,
    'Service appointment created from estimate ' || p_estimate_id::text
  );

  insert into public.ops_invoice_status_events (
    invoice_id, from_status, to_status, changed_by, notes
  ) values (
    invoice_id,
    null,
    'draft',
    p_actor_user_id,
    'Invoice created from converted estimate'
  );

  update public.ops_appointments
  set estimate_status = 'converted',
      converted_appointment_id = service_appointment_id,
      updated_at = now()
  where id = p_estimate_id
    and converted_appointment_id is null
    and updated_at = p_expected_updated_at;
  if not found then
    raise exception 'The estimate changed during conversion; inspect it before retrying.'
      using errcode = 'serialization_failure';
  end if;

  insert into public.ops_appointment_status_events (
    appointment_id, from_status, to_status, changed_by, notes
  ) values (
    p_estimate_id,
    estimate_row.estimate_status,
    'converted',
    p_actor_user_id,
    'Converted to service appointment ' || service_appointment_id::text
  );

  return jsonb_build_object(
    'estimate_id', p_estimate_id,
    'appointment_id', service_appointment_id,
    'invoice_id', invoice_id,
    'subtotal', calculated_subtotal,
    'discount_amount', calculated_discount,
    'total', calculated_total
  );
end;
$$;

revoke all on function public.mcp_convert_estimate(
  uuid, timestamptz, text, date, time, time, uuid, numeric, uuid, text, boolean
) from public, anon, authenticated;
grant execute on function public.mcp_convert_estimate(
  uuid, timestamptz, text, date, time, time, uuid, numeric, uuid, text, boolean
) to service_role;

comment on function public.mcp_convert_estimate(
  uuid, timestamptz, text, date, time, time, uuid, numeric, uuid, text, boolean
) is 'Atomically converts one stale-checked estimate to a booked service appointment and draft invoice.';

create or replace function public.mcp_update_customer(
  p_customer_id uuid,
  p_expected_customer_updated_at timestamptz,
  p_customer_changes jsonb,
  p_address_id uuid,
  p_expected_address_updated_at timestamptz,
  p_address_changes jsonb,
  p_blacklist_id uuid default null,
  p_blacklist_phone text default null,
  p_blacklist_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  customer_row public.ops_customers%rowtype;
  address_row public.ops_service_addresses%rowtype;
  changed_at timestamptz := now();
begin
  select customer.* into customer_row
  from public.ops_customers customer
  where customer.id = p_customer_id
  for update;
  if not found then raise exception 'Customer not found.' using errcode = 'no_data_found'; end if;
  if customer_row.updated_at is distinct from p_expected_customer_updated_at then
    raise exception 'Customer changed after preview; preview again.' using errcode = 'serialization_failure';
  end if;

  if p_address_id is not null then
    select address.* into address_row
    from public.ops_service_addresses address
    where address.id = p_address_id and address.customer_id = p_customer_id
    for update;
    if not found then raise exception 'Service address not found.' using errcode = 'no_data_found'; end if;
    if address_row.updated_at is distinct from p_expected_address_updated_at then
      raise exception 'Service address changed after preview; preview again.' using errcode = 'serialization_failure';
    end if;
  end if;

  if coalesce(p_customer_changes, '{}'::jsonb) <> '{}'::jsonb then
    update public.ops_customers
    set first_name = case when p_customer_changes ? 'first_name' then nullif(p_customer_changes ->> 'first_name', '') else first_name end,
        last_name = case when p_customer_changes ? 'last_name' then nullif(p_customer_changes ->> 'last_name', '') else last_name end,
        full_name = case when p_customer_changes ? 'full_name' then nullif(p_customer_changes ->> 'full_name', '') else full_name end,
        business_name = case when p_customer_changes ? 'business_name' then nullif(p_customer_changes ->> 'business_name', '') else business_name end,
        email = case when p_customer_changes ? 'email' then nullif(p_customer_changes ->> 'email', '') else email end,
        phone = case when p_customer_changes ? 'phone' then nullif(p_customer_changes ->> 'phone', '') else phone end,
        notes = case when p_customer_changes ? 'notes' then nullif(p_customer_changes ->> 'notes', '') else notes end,
        email_opt_out = case when p_customer_changes ? 'email_opt_out' then (p_customer_changes ->> 'email_opt_out')::boolean else email_opt_out end,
        updated_at = changed_at
    where id = p_customer_id;
  end if;

  if p_address_id is not null and coalesce(p_address_changes, '{}'::jsonb) <> '{}'::jsonb then
    update public.ops_service_addresses
    set label = case when p_address_changes ? 'label' then nullif(p_address_changes ->> 'label', '') else label end,
        street_1 = case when p_address_changes ? 'street_1' then nullif(p_address_changes ->> 'street_1', '') else street_1 end,
        street_2 = case when p_address_changes ? 'street_2' then nullif(p_address_changes ->> 'street_2', '') else street_2 end,
        city = case when p_address_changes ? 'city' then nullif(p_address_changes ->> 'city', '') else city end,
        state = case when p_address_changes ? 'state' then nullif(p_address_changes ->> 'state', '') else state end,
        zip_code = case when p_address_changes ? 'zip_code' then nullif(p_address_changes ->> 'zip_code', '') else zip_code end,
        gate_code = case when p_address_changes ? 'gate_code' then nullif(p_address_changes ->> 'gate_code', '') else gate_code end,
        notes = case when p_address_changes ? 'notes' then nullif(p_address_changes ->> 'notes', '') else notes end,
        latitude = case when p_address_changes ?| array['street_1', 'city', 'state', 'zip_code'] then null else latitude end,
        longitude = case when p_address_changes ?| array['street_1', 'city', 'state', 'zip_code'] then null else longitude end,
        geocoded_at = case when p_address_changes ?| array['street_1', 'city', 'state', 'zip_code'] then null else geocoded_at end,
        geocode_source = case when p_address_changes ?| array['street_1', 'city', 'state', 'zip_code'] then null else geocode_source end,
        updated_at = changed_at
    where id = p_address_id;
  end if;

  if p_blacklist_id is not null then
    update public.blacklist
    set phone = p_blacklist_phone, name = p_blacklist_name
    where id = p_blacklist_id;
    if not found then raise exception 'Blacklist entry changed after preview; preview again.' using errcode = 'serialization_failure'; end if;
  end if;

  return jsonb_build_object(
    'customer_id', p_customer_id,
    'address_id', p_address_id,
    'updated_at', changed_at
  );
end;
$$;

revoke all on function public.mcp_update_customer(uuid, timestamptz, jsonb, uuid, timestamptz, jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function public.mcp_update_customer(uuid, timestamptz, jsonb, uuid, timestamptz, jsonb, uuid, text, text) to service_role;

create or replace function public.mcp_save_estimate(
  p_estimate_id uuid,
  p_expected_updated_at timestamptz,
  p_payload jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  estimate_row public.ops_appointments%rowtype;
  saved_estimate_id uuid;
  assigned_staff_auth_id uuid;
  appointment_date_value date := (p_payload ->> 'appointment_date')::date;
  start_time_value time := (p_payload ->> 'start_time')::time;
  end_time_value time := (p_payload ->> 'end_time')::time;
  staff_id_value uuid := nullif(p_payload ->> 'assigned_staff_user_id', '')::uuid;
  customer_id_value uuid := (p_payload ->> 'customer_id')::uuid;
  address_id_value uuid := (p_payload ->> 'service_address_id')::uuid;
  line_items_value jsonb := p_payload -> 'line_items';
  total_value numeric(10, 2);
begin
  if end_time_value <= start_time_value then
    raise exception 'Estimate end time must be after start time.' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.ops_service_addresses address
    where address.id = address_id_value and address.customer_id = customer_id_value
  ) then
    raise exception 'Estimate service address no longer belongs to the customer.' using errcode = 'foreign_key_violation';
  end if;
  if staff_id_value is null then
    raise exception 'A scheduled estimate requires an assigned technician.' using errcode = 'check_violation';
  end if;
  select staff.user_id into assigned_staff_auth_id
  from public.staff_users staff
  where staff.id = staff_id_value and staff.is_active = true;
  if not found then raise exception 'Choose an active technician.' using errcode = 'check_violation'; end if;

  perform pg_advisory_xact_lock(hashtextextended(staff_id_value::text || ':' || appointment_date_value::text, 0));

  if p_estimate_id is not null then
    select estimate.* into estimate_row
    from public.ops_appointments estimate
    where estimate.id = p_estimate_id and estimate.kind = 'estimate'
    for update;
    if not found then raise exception 'Estimate not found.' using errcode = 'no_data_found'; end if;
    if estimate_row.updated_at is distinct from p_expected_updated_at then
      raise exception 'Estimate changed after preview; preview again.' using errcode = 'serialization_failure';
    end if;
    if estimate_row.converted_appointment_id is not null or estimate_row.estimate_status = 'converted' then
      raise exception 'A converted estimate cannot be revised.' using errcode = 'check_violation';
    end if;
  end if;

  if line_items_value is not null then
    if jsonb_typeof(line_items_value) <> 'array' or jsonb_array_length(line_items_value) = 0 then
      raise exception 'At least one estimate line item is required.' using errcode = 'check_violation';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(line_items_value) line
      where nullif(line ->> 'service_id', '') is not null
        and not exists (
          select 1 from public.service_catalog_items catalog
          where catalog.id = (line ->> 'service_id')::uuid and catalog.is_active = true
        )
    ) then
      raise exception 'An estimate service is no longer active; preview again.' using errcode = 'foreign_key_violation';
    end if;
    select round(coalesce(sum((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric), 0), 2)
    into total_value
    from jsonb_array_elements(line_items_value) line;
  elsif p_estimate_id is not null then
    select round(coalesce(sum(line.line_total), 0), 2) into total_value
    from public.ops_appointment_line_items line where line.appointment_id = p_estimate_id;
  else
    raise exception 'Line items are required for a new estimate.' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.ops_appointments existing
    where existing.id <> coalesce(p_estimate_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and existing.appointment_date = appointment_date_value
      and coalesce(existing.is_subcontracted, false) = false
      and existing.status in ('booked', 'confirmed', 'on_my_way', 'in_progress', 'pending_approval')
      and (existing.assigned_staff_user_id is null or existing.assigned_staff_user_id = staff_id_value)
      and start_time_value < existing.end_time and end_time_value > existing.start_time
  ) or exists (
    select 1 from public.ops_calendar_events event
    where event.event_kind = 'block'
      and event.start_date <= appointment_date_value and event.end_date >= appointment_date_value
      and (event.assigned_staff_user_id is null or event.assigned_staff_user_id = staff_id_value or event.assigned_staff_user_id = assigned_staff_auth_id)
      and start_time_value < case when event.is_all_day or event.end_time is null then time '23:59:00' else event.end_time end
      and end_time_value > case when event.is_all_day or event.start_time is null then time '00:00:00' else event.start_time end
  ) then
    raise exception 'The estimate technician/time is no longer available.' using errcode = 'check_violation';
  end if;

  if p_estimate_id is null then
    insert into public.ops_appointments (
      customer_id, service_address_id, appointment_date, start_time, end_time,
      assigned_staff_user_id, internal_notes, quoted_total, kind, status,
      estimate_status, payment_status, quickbooks_sync_status, booking_channel, source
    ) values (
      customer_id_value, address_id_value, appointment_date_value, start_time_value,
      end_time_value, staff_id_value, p_payload ->> 'internal_notes', total_value,
      'estimate', 'confirmed', 'draft', 'unpaid', 'held', 'mcp', 'Dot MCP'
    ) returning id into saved_estimate_id;
    insert into public.ops_appointment_status_events (appointment_id, from_status, to_status, changed_by, notes)
    values (saved_estimate_id, null, 'confirmed', p_actor_user_id, 'Draft estimate created through MCP');
  else
    saved_estimate_id := p_estimate_id;
    update public.ops_appointments
    set customer_id = customer_id_value,
        service_address_id = address_id_value,
        appointment_date = appointment_date_value,
        start_time = start_time_value,
        end_time = end_time_value,
        assigned_staff_user_id = staff_id_value,
        internal_notes = p_payload ->> 'internal_notes',
        quoted_total = total_value,
        updated_at = now()
    where id = saved_estimate_id and updated_at = p_expected_updated_at;
    if not found then raise exception 'Estimate changed during save; preview again.' using errcode = 'serialization_failure'; end if;
  end if;

  if line_items_value is not null then
    delete from public.ops_appointment_line_items where appointment_id = saved_estimate_id;
    insert into public.ops_appointment_line_items (
      appointment_id, service_catalog_item_id, name_snapshot, quantity,
      unit_price, line_total, duration_minutes, buffer_minutes
    )
    select saved_estimate_id,
      nullif(line ->> 'service_id', '')::uuid,
      line ->> 'description',
      (line ->> 'quantity')::numeric,
      (line ->> 'unit_price')::numeric,
      round((line ->> 'quantity')::numeric * (line ->> 'unit_price')::numeric, 2),
      60, 0
    from jsonb_array_elements(line_items_value) line;
  end if;

  return jsonb_build_object('estimate_id', saved_estimate_id, 'status', 'draft', 'quoted_total', total_value, 'customer_contacted', false);
end;
$$;

revoke all on function public.mcp_save_estimate(uuid, timestamptz, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.mcp_save_estimate(uuid, timestamptz, jsonb, uuid) to service_role;

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

-- Preserve the existing owner gate while allowing future, explicitly granted
-- scopes to reach the token. Existing production grants remain business:read.
create or replace function public.sasquatch_mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  claims jsonb := event -> 'claims';
  oauth_client_id text := coalesce(
    event ->> 'client_id',
    event -> 'claims' ->> 'client_id'
  );
  is_oauth_token boolean :=
    oauth_client_id is not null
    or event ->> 'authentication_method' = 'oauth_provider/authorization_code';
  granted_scopes text[];
begin
  if not is_oauth_token then
    return event;
  end if;

  select authorized.scopes
  into granted_scopes
  from public.mcp_authorized_users authorized
  join public.staff_users staff on staff.user_id = authorized.user_id
  where authorized.user_id = (event ->> 'user_id')::uuid
    and authorized.revoked_at is null
    and 'business:read' = any(authorized.scopes)
    and staff.role = 'owner'
    and staff.is_active = true;

  claims := jsonb_set(
    claims,
    '{aud}',
    to_jsonb('https://sightings.sasquatchcarpet.com/mcp'::text),
    true
  );

  if granted_scopes is not null then
    claims := jsonb_set(
      claims,
      '{mcp_access}',
      to_jsonb('business:read'::text),
      true
    );
    claims := jsonb_set(
      claims,
      '{mcp_scopes}',
      to_jsonb(granted_scopes),
      true
    );
  else
    claims := claims - 'mcp_access' - 'mcp_scopes';
  end if;

  return jsonb_set(event, '{claims}', claims, true);
end;
$$;
