\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid()
);

create table public.staff_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  display_name text not null,
  role text not null,
  is_active boolean not null default true
);

create table public.mcp_authorized_users (
  user_id uuid primary key references auth.users(id),
  scopes text[] not null default array['business:read']::text[],
  revoked_at timestamptz
);

create table public.ops_customers (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  full_name text not null,
  business_name text,
  email text,
  phone text not null,
  notes text,
  email_opt_out boolean not null default false,
  quickbooks_customer_id text,
  updated_at timestamptz not null default now()
);

create table public.ops_service_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ops_customers(id),
  label text,
  street_1 text not null,
  street_2 text,
  city text not null,
  town_slug text,
  state text not null,
  zip_code text not null,
  gate_code text,
  notes text,
  latitude numeric,
  longitude numeric,
  geocoded_at timestamptz,
  geocode_source text,
  updated_at timestamptz not null default now()
);

create table public.service_catalog_items (
  id uuid primary key default gen_random_uuid(),
  base_price numeric(10, 2),
  is_active boolean not null default true
);

create table public.blacklist (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text not null
);

create table public.ops_appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ops_customers(id),
  service_address_id uuid not null references public.ops_service_addresses(id),
  assigned_staff_user_id uuid references public.staff_users(id),
  appointment_date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'booked',
  payment_status text not null default 'unpaid',
  kind text not null default 'service',
  booking_channel text not null default 'admin',
  source text not null default 'internal',
  quickbooks_sync_status text not null default 'held',
  quoted_total numeric(10, 2) not null default 0,
  internal_notes text,
  lead_source text,
  lead_source_key text,
  lead_source_detail text,
  original_lead_source text,
  estimate_status text,
  converted_appointment_id uuid references public.ops_appointments(id),
  is_subcontracted boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.ops_appointment_line_items (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.ops_appointments(id) on delete cascade,
  service_catalog_item_id uuid references public.service_catalog_items(id),
  name_snapshot text not null,
  notes text,
  quantity numeric(10, 2) not null,
  unit_price numeric(10, 2) not null,
  duration_minutes integer not null default 0,
  buffer_minutes integer not null default 0,
  line_total numeric(10, 2) not null,
  length_value numeric(10, 2),
  width_value numeric(10, 2),
  pricing_unit_snapshot text,
  area_segments jsonb
);

create table public.ops_invoices (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.ops_appointments(id),
  status text not null,
  payment_status text not null,
  subtotal numeric(10, 2) not null,
  discount_amount numeric(10, 2) not null,
  total numeric(10, 2) not null,
  sync_status text not null
);

create table public.ops_invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.ops_invoices(id),
  appointment_line_item_id uuid references public.ops_appointment_line_items(id),
  description text not null,
  quantity numeric(10, 2) not null,
  unit_price numeric(10, 2) not null,
  line_total numeric(10, 2) not null
);

create table public.ops_appointment_status_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.ops_appointments(id),
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id),
  notes text
);

create table public.ops_invoice_status_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.ops_invoices(id),
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id),
  notes text
);

create table public.ops_calendar_events (
  id uuid primary key default gen_random_uuid(),
  event_kind text not null,
  start_date date not null,
  end_date date not null,
  start_time time,
  end_time time,
  is_all_day boolean not null default false,
  assigned_staff_user_id uuid
);

-- APPLY_MCP_OPERATION_CONTROLS_MIGRATION_HERE

insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000001');
insert into public.staff_users (id, user_id, display_name, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Fixture Tech', 'owner');
insert into public.mcp_authorized_users (user_id, scopes) values
  ('10000000-0000-4000-8000-000000000001', array['business:read', 'business:write', 'finance:write', 'estimates:write']);
insert into public.ops_customers (id, full_name, email, phone) values
  ('30000000-0000-4000-8000-000000000001', 'Fixture Customer', 'fixture@example.test', '+17195550123');
insert into public.ops_service_addresses (id, customer_id, street_1, city, state, zip_code) values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '123 Fixture St', 'Colorado Springs', 'CO', '80903');
insert into public.service_catalog_items (id, base_price) values
  ('60000000-0000-4000-8000-000000000001', 100),
  ('60000000-0000-4000-8000-000000000002', 777);

-- Customer/address changes succeed together and reset stale geocoding.
update public.ops_service_addresses set latitude = 38.8, longitude = -104.8,
  geocoded_at = now(), geocode_source = 'fixture'
where id = '40000000-0000-4000-8000-000000000001';
do $$
declare
  customer_stamp timestamptz;
  address_stamp timestamptz;
begin
  select updated_at into customer_stamp from public.ops_customers where id = '30000000-0000-4000-8000-000000000001';
  select updated_at into address_stamp from public.ops_service_addresses where id = '40000000-0000-4000-8000-000000000001';
  perform public.mcp_update_customer(
    '30000000-0000-4000-8000-000000000001', customer_stamp,
    '{"full_name":"Updated Fixture Customer","notes":"atomic customer update"}',
    '40000000-0000-4000-8000-000000000001', address_stamp,
    '{"street_1":"125 Fixture St","notes":"atomic address update"}',
    null, null, null
  );
  if not exists (select 1 from public.ops_customers where id = '30000000-0000-4000-8000-000000000001' and full_name = 'Updated Fixture Customer') then
    raise exception 'atomic customer update failed';
  end if;
  if not exists (select 1 from public.ops_service_addresses where id = '40000000-0000-4000-8000-000000000001' and street_1 = '125 Fixture St' and latitude is null and longitude is null and geocoded_at is null) then
    raise exception 'atomic address update or geocode reset failed';
  end if;
end $$;

-- A blacklist uniqueness failure rolls back customer and address changes too.
insert into public.blacklist (id, phone, name) values
  ('70000000-0000-4000-8000-000000000001', '7195550123', 'Updated Fixture Customer'),
  ('70000000-0000-4000-8000-000000000002', '7195550999', 'Other Blocked Customer');
do $$
declare
  customer_stamp timestamptz;
  address_stamp timestamptz;
begin
  select updated_at into customer_stamp from public.ops_customers where id = '30000000-0000-4000-8000-000000000001';
  select updated_at into address_stamp from public.ops_service_addresses where id = '40000000-0000-4000-8000-000000000001';
  begin
    perform public.mcp_update_customer(
      '30000000-0000-4000-8000-000000000001', customer_stamp,
      '{"notes":"must roll back"}',
      '40000000-0000-4000-8000-000000000001', address_stamp,
      '{"notes":"must roll back"}',
      '70000000-0000-4000-8000-000000000001', '7195550999', 'Conflict'
    );
    raise exception 'blacklist conflict unexpectedly succeeded';
  exception when unique_violation then null;
  end;
  if exists (select 1 from public.ops_customers where id = '30000000-0000-4000-8000-000000000001' and notes = 'must roll back')
     or exists (select 1 from public.ops_service_addresses where id = '40000000-0000-4000-8000-000000000001' and notes = 'must roll back') then
    raise exception 'failed customer update was not rolled back';
  end if;
end $$;

-- Draft estimate creation and line replacement are one transaction.
select public.mcp_save_estimate(
  null, null,
  jsonb_build_object(
    'customer_id', '30000000-0000-4000-8000-000000000001',
    'service_address_id', '40000000-0000-4000-8000-000000000001',
    'appointment_date', '2030-02-10', 'start_time', '08:00', 'end_time', '09:00',
    'assigned_staff_user_id', '20000000-0000-4000-8000-000000000001',
    'internal_notes', 'atomic estimate fixture',
    'line_items', jsonb_build_array(jsonb_build_object(
      'service_id', '60000000-0000-4000-8000-000000000001',
      'description', 'Fixture service', 'quantity', 2, 'unit_price', 100
    ))
  ),
  '10000000-0000-4000-8000-000000000001'
) as saved_estimate \gset

do $$
begin
  if (select count(*) from public.ops_appointments where kind = 'estimate' and internal_notes = 'atomic estimate fixture' and quoted_total = 200) <> 1 then
    raise exception 'draft estimate was not created';
  end if;
  if (select count(*) from public.ops_appointment_line_items line join public.ops_appointments estimate on estimate.id = line.appointment_id where estimate.internal_notes = 'atomic estimate fixture') <> 1 then
    raise exception 'draft estimate lines were not created';
  end if;
end $$;

create function public.fixture_fail_estimate_line() returns trigger language plpgsql as $$
begin
  if new.name_snapshot = 'force-estimate-failure' then
    raise exception 'forced estimate line failure' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger fixture_fail_estimate_line before insert on public.ops_appointment_line_items
for each row execute function public.fixture_fail_estimate_line();

do $$
begin
  begin
    perform public.mcp_save_estimate(
      null, null,
      jsonb_build_object(
        'customer_id', '30000000-0000-4000-8000-000000000001',
        'service_address_id', '40000000-0000-4000-8000-000000000001',
        'appointment_date', '2030-02-10', 'start_time', '10:00', 'end_time', '11:00',
        'assigned_staff_user_id', '20000000-0000-4000-8000-000000000001',
        'internal_notes', 'failed estimate fixture',
        'line_items', jsonb_build_array(jsonb_build_object(
          'service_id', '60000000-0000-4000-8000-000000000001',
          'description', 'force-estimate-failure', 'quantity', 1, 'unit_price', 100
        ))
      ),
      '10000000-0000-4000-8000-000000000001'
    );
    raise exception 'forced estimate failure unexpectedly succeeded';
  exception when check_violation then null;
  end;
  if exists (select 1 from public.ops_appointments where internal_notes = 'failed estimate fixture') then
    raise exception 'failed estimate save left an orphan appointment';
  end if;
end $$;

-- Appointment/customer/address/lines/invoice/history commit together.
select public.mcp_create_appointment(
  jsonb_build_object(
    'customer', jsonb_build_object('first_name', 'Atomic', 'last_name', 'Booking', 'email', 'atomic@example.test', 'phone', '+17195550188'),
    'address', jsonb_build_object('street_1', '900 Atomic Ave', 'street_2', '', 'city', 'Colorado Springs', 'town_slug', 'colorado-springs', 'state', 'CO', 'zip_code', '80903'),
    'appointment_date', '2030-02-11', 'start_time', '08:00', 'end_time', '09:00',
    'assigned_staff_user_id', '20000000-0000-4000-8000-000000000001',
    'appointment_status', 'booked', 'subtotal', 100, 'discount_applied', 0, 'total', 100,
    'sync_status', 'held',
    'lead_source', jsonb_build_object('lead_source', 'MCP', 'lead_source_key', 'mcp', 'lead_source_detail', null, 'original_lead_source', null),
    'line_items', jsonb_build_array(jsonb_build_object(
      'service_catalog_item_id', '60000000-0000-4000-8000-000000000001',
      'name_snapshot', 'Fixture service', 'quantity', 1, 'unit_price', 100,
      'line_total', 100, 'duration_minutes', 60, 'pricing_unit', 'fixed'
    ))
  ),
  '10000000-0000-4000-8000-000000000001'
) as created_appointment \gset

do $$
declare
  appointment_id_value uuid;
  invoice_id_value uuid;
begin
  select id into appointment_id_value from public.ops_appointments where source = 'Dot MCP' and quoted_total = 100;
  if appointment_id_value is null then raise exception 'atomic appointment missing'; end if;
  select id into invoice_id_value from public.ops_invoices where appointment_id = appointment_id_value;
  if invoice_id_value is null then raise exception 'atomic appointment invoice missing'; end if;
  if (select count(*) from public.ops_appointment_line_items where appointment_id = appointment_id_value) <> 1
     or (select count(*) from public.ops_invoice_line_items where invoice_id = invoice_id_value) <> 1
     or (select count(*) from public.ops_appointment_status_events where appointment_id = appointment_id_value) <> 1
     or (select count(*) from public.ops_invoice_status_events where invoice_id = invoice_id_value) <> 1 then
    raise exception 'atomic appointment dependent rows are incomplete';
  end if;
end $$;

-- Successful atomic conversion with measurement preservation.
insert into public.ops_appointments (
  id, customer_id, service_address_id, appointment_date, start_time, end_time,
  kind, status, estimate_status, quoted_total, updated_at
) values (
  '50000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '2030-01-15', '08:00', '08:30', 'estimate', 'booked', 'accepted', 1014,
  '2026-10-13T03:00:00Z'
);
insert into public.ops_appointment_line_items (
  appointment_id, name_snapshot, quantity, unit_price, line_total,
  duration_minutes, length_value, width_value, pricing_unit_snapshot, area_segments
) values
  ('50000000-0000-4000-8000-000000000001', 'Commercial carpet', 2600, 0.35, 910, 30, 40, 60, 'per_sq_ft', '[{"length":40,"width":60}]'),
  ('50000000-0000-4000-8000-000000000001', 'Deodorizer', 2600, 0.04, 104, 10, 40, 60, 'per_sq_ft', '[{"length":40,"width":60}]');

select public.mcp_convert_estimate(
  '50000000-0000-4000-8000-000000000001',
  '2026-10-13T03:00:00Z',
  'accepted',
  '2030-01-16',
  '09:00',
  '13:30',
  '20000000-0000-4000-8000-000000000001',
  14,
  '10000000-0000-4000-8000-000000000001',
  'held',
  false
) as successful_conversion \gset

do $$
declare
  service_id uuid;
  invoice_row public.ops_invoices%rowtype;
begin
  select converted_appointment_id into service_id
  from public.ops_appointments
  where id = '50000000-0000-4000-8000-000000000001'
    and estimate_status = 'converted';
  if service_id is null then raise exception 'estimate was not converted'; end if;
  if (select count(*) from public.ops_appointments where id = service_id and kind = 'service') <> 1 then
    raise exception 'service appointment missing';
  end if;
  if (select count(*) from public.ops_appointment_line_items where appointment_id = service_id) <> 2 then
    raise exception 'line items were not copied exactly once';
  end if;
  if (select count(*) from public.ops_appointment_line_items where appointment_id = service_id and length_value = 40 and width_value = 60 and area_segments is not null) <> 2 then
    raise exception 'measurement fields were not preserved';
  end if;
  select * into invoice_row from public.ops_invoices where appointment_id = service_id;
  if invoice_row.subtotal <> 1014 or invoice_row.discount_amount <> 14 or invoice_row.total <> 1000 then
    raise exception 'invoice totals are incorrect';
  end if;
  if (select count(*) from public.ops_invoice_line_items where invoice_id = invoice_row.id) <> 2 then
    raise exception 'invoice lines were not copied';
  end if;
  if (select count(*) from public.ops_appointment_status_events where appointment_id in (service_id, '50000000-0000-4000-8000-000000000001')) <> 2 then
    raise exception 'appointment status history is incomplete';
  end if;
  if (select count(*) from public.ops_invoice_status_events where invoice_id = invoice_row.id) <> 1 then
    raise exception 'invoice status history is incomplete';
  end if;
end $$;

-- Replays fail without creating a second appointment.
do $$
begin
  perform public.mcp_convert_estimate(
    '50000000-0000-4000-8000-000000000001',
    '2026-10-13T03:00:00Z', 'accepted', '2030-01-16', '09:00', '13:30',
    '20000000-0000-4000-8000-000000000001', 14,
    '10000000-0000-4000-8000-000000000001', 'held', false
  );
  raise exception 'duplicate conversion unexpectedly succeeded';
exception when unique_violation then null;
end $$;

-- A forced invoice failure rolls back the appointment and copied lines too.
create function public.fixture_fail_invoice() returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.ops_appointments
    where id = new.appointment_id
      and (internal_notes = 'force-fixture-failure' or quoted_total = 777)
  ) then
    raise exception 'forced invoice failure' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger fixture_fail_invoice before insert on public.ops_invoices
for each row execute function public.fixture_fail_invoice();

-- A forced invoice failure also rolls back MCP appointment/customer/address/line creation.
do $$
begin
  begin
    perform public.mcp_create_appointment(
      jsonb_build_object(
        'customer', jsonb_build_object('first_name', 'Rollback', 'last_name', 'Booking', 'email', 'rollback@example.test', 'phone', '+17195550199'),
        'address', jsonb_build_object('street_1', '901 Atomic Ave', 'street_2', '', 'city', 'Colorado Springs', 'town_slug', 'colorado-springs', 'state', 'CO', 'zip_code', '80903'),
        'appointment_date', '2030-02-12', 'start_time', '08:00', 'end_time', '09:00',
        'assigned_staff_user_id', '20000000-0000-4000-8000-000000000001',
        'appointment_status', 'booked', 'subtotal', 777, 'discount_applied', 0, 'total', 777,
        'sync_status', 'held',
        'lead_source', jsonb_build_object('lead_source', 'MCP', 'lead_source_key', 'mcp', 'lead_source_detail', null, 'original_lead_source', null),
        'line_items', jsonb_build_array(jsonb_build_object(
          'service_catalog_item_id', '60000000-0000-4000-8000-000000000002',
          'name_snapshot', 'Rollback service', 'quantity', 1, 'unit_price', 777,
          'line_total', 777, 'duration_minutes', 60, 'pricing_unit', 'fixed'
        ))
      ),
      '10000000-0000-4000-8000-000000000001'
    );
    raise exception 'forced appointment failure unexpectedly succeeded';
  exception when check_violation then null;
  end;
  if exists (select 1 from public.ops_appointments where source = 'Dot MCP' and quoted_total = 777)
     or exists (select 1 from public.ops_customers where email = 'rollback@example.test') then
    raise exception 'failed appointment creation was not fully rolled back';
  end if;
end $$;

insert into public.ops_appointments (
  id, customer_id, service_address_id, appointment_date, start_time, end_time,
  kind, status, estimate_status, internal_notes, updated_at
) values (
  '50000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '2030-01-15', '08:00', '08:30', 'estimate', 'booked', 'accepted',
  'force-fixture-failure', '2026-10-13T04:00:00Z'
);
insert into public.ops_appointment_line_items (
  appointment_id, name_snapshot, quantity, unit_price, line_total
) values ('50000000-0000-4000-8000-000000000002', 'Fixture line', 1, 100, 100);

do $$
begin
  perform public.mcp_convert_estimate(
    '50000000-0000-4000-8000-000000000002',
    '2026-10-13T04:00:00Z', 'accepted', '2030-01-17', '09:00', '11:30',
    '20000000-0000-4000-8000-000000000001', 0,
    '10000000-0000-4000-8000-000000000001', 'held', false
  );
  raise exception 'forced failure unexpectedly succeeded';
exception when check_violation then null;
end $$;

do $$
begin
  if exists (
    select 1 from public.ops_appointments
    where kind = 'service' and internal_notes = 'force-fixture-failure'
  ) then raise exception 'failed conversion left an orphan appointment'; end if;
  if exists (
    select 1 from public.ops_appointments
    where id = '50000000-0000-4000-8000-000000000002'
      and (estimate_status = 'converted' or converted_appointment_id is not null)
  ) then raise exception 'failed conversion changed the estimate'; end if;
end $$;

do $$
begin
  if has_function_privilege(
    'authenticated',
    'public.mcp_convert_estimate(uuid,timestamp with time zone,text,date,time without time zone,time without time zone,uuid,numeric,uuid,text,boolean)',
    'execute'
  ) then raise exception 'authenticated role can execute conversion'; end if;
  if not has_function_privilege(
    'service_role',
    'public.mcp_convert_estimate(uuid,timestamp with time zone,text,date,time without time zone,time without time zone,uuid,numeric,uuid,text,boolean)',
    'execute'
  ) then raise exception 'service_role cannot execute conversion'; end if;
  if has_function_privilege('authenticated', 'public.mcp_update_customer(uuid,timestamp with time zone,jsonb,uuid,timestamp with time zone,jsonb,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.mcp_save_estimate(uuid,timestamp with time zone,jsonb,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.mcp_create_appointment(jsonb,uuid)', 'execute') then
    raise exception 'authenticated role can execute a restricted MCP transaction';
  end if;
  if not has_function_privilege('service_role', 'public.mcp_update_customer(uuid,timestamp with time zone,jsonb,uuid,timestamp with time zone,jsonb,uuid,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.mcp_save_estimate(uuid,timestamp with time zone,jsonb,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.mcp_create_appointment(jsonb,uuid)', 'execute') then
    raise exception 'service_role cannot execute a restricted MCP transaction';
  end if;
end $$;

select 'mcp operation controls fixture passed' as result;
