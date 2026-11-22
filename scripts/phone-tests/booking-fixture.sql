-- Extend the shared MCP operations fixture with the later phone and calendar schema.
alter table ops_appointments add column parked_at timestamptz;
alter table ops_customers add column is_commercial boolean default false;
alter table ops_invoices add column discount_metadata jsonb;
alter table staff_users add column show_on_calendar boolean default true,
  add column default_open boolean default true, add column scheduling_priority integer default 1;
create table call_logs(call_sid text primary key,caller_phone text,outcome text,updated_at timestamptz);
create table staff_daily_availability(staff_user_id uuid,date date,is_open boolean);
create table availability_templates(id uuid,staff_user_id uuid,day_of_week integer,start_time time,end_time time,slot_interval_minutes integer,is_active boolean);
create table availability_overrides(id uuid,staff_user_id uuid,override_date date,start_time time,end_time time,is_available boolean);
create table promo_codes(id uuid primary key default gen_random_uuid(),code text,active boolean,expires_at timestamptz,
  max_uses integer,use_count integer default 0,discount_type text,discount_amount numeric);
create table promo_code_tiers(promo_code_id uuid,min_spend numeric,discount_amount numeric);
create table ops_communication_templates(template_key text primary key,is_enabled boolean);
create table ops_communication_queue(template_key text references ops_communication_templates(template_key),
  appointment_id uuid references ops_appointments(id),customer_id uuid references ops_customers(id),scheduled_for timestamptz,payload jsonb);
insert into ops_communication_templates values('job_scheduled_email',true);
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001');
insert into staff_users(id,user_id,display_name,role) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Fixture tech','tech');
insert into service_catalog_items(id,base_price) values ('30000000-0000-4000-8000-000000000001',46);
