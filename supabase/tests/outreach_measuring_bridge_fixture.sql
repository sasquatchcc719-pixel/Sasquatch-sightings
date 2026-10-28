-- Local PostgreSQL/PGlite fixture only. Never run on a real Sightings database.
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.staff_users(id uuid primary key, user_id uuid, display_name text not null, is_active boolean default true, show_on_calendar boolean default true, default_open boolean default true, scheduling_priority integer default 0);
create table public.staff_daily_availability(staff_user_id uuid, date date, is_open boolean);
create table public.availability_templates(id uuid primary key default gen_random_uuid(), staff_user_id uuid, day_of_week integer, start_time time, end_time time, slot_interval_minutes integer, is_active boolean);
create table public.availability_overrides(id uuid primary key default gen_random_uuid(), staff_user_id uuid, override_date date, start_time time, end_time time, is_available boolean);
create table public.ops_customers(id uuid primary key default gen_random_uuid(), full_name text not null, business_name text, email text, phone text not null, is_commercial boolean default false, updated_at timestamptz default now());
create table public.ops_service_addresses(id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.ops_customers(id), label text, street_1 text not null, street_2 text, city text not null, state text not null, zip_code text not null, updated_at timestamptz default now());
create table public.ops_appointments(id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.ops_customers(id), service_address_id uuid not null references public.ops_service_addresses(id), appointment_date date, start_time time, end_time time, assigned_staff_user_id uuid references public.staff_users(id), status text, payment_status text, booking_channel text, source text, kind text, estimate_status text, quickbooks_sync_status text, quoted_total numeric, internal_notes text, lead_source text, is_subcontracted boolean default false);
create table public.ops_appointment_status_events(id uuid primary key default gen_random_uuid(), appointment_id uuid references public.ops_appointments(id), from_status text, to_status text, notes text);
create table public.ops_appointment_line_items(id uuid primary key default gen_random_uuid(), appointment_id uuid references public.ops_appointments(id), name_snapshot text, quantity numeric, unit_price numeric);
create table public.ops_invoices(id uuid primary key default gen_random_uuid(), appointment_id uuid references public.ops_appointments(id));
create table public.ops_calendar_events(id uuid primary key default gen_random_uuid(), event_kind text, start_date date, end_date date, start_time time, end_time time, is_all_day boolean, assigned_staff_user_id uuid);
create table public.blacklist(id uuid primary key default gen_random_uuid(), phone text);
-- APPLY_OUTREACH_MEASURING_BRIDGE_MIGRATION_HERE

grant usage on schema public to service_role;
grant select on public.staff_users, public.staff_daily_availability, public.availability_templates, public.availability_overrides, public.blacklist, public.ops_calendar_events to service_role;
grant select,insert,update on public.ops_customers, public.ops_service_addresses, public.ops_appointments to service_role;
grant insert on public.ops_appointment_status_events to service_role;
-- PostgreSQL table locks require a write privilege on every locked relation.
grant update on public.staff_users, public.staff_daily_availability, public.availability_templates, public.availability_overrides, public.blacklist, public.ops_calendar_events to service_role;

insert into public.staff_users(id,user_id,display_name) values('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006','Fixture Estimator');
insert into public.availability_templates(staff_user_id,day_of_week,start_time,end_time,slot_interval_minutes,is_active) values('10000000-0000-4000-8000-000000000005',1,'09:00','18:00',120,true);
insert into public.ops_customers(id,full_name,business_name,email,phone) values('10000000-0000-4000-8000-000000000003','Saved Contact','Saved Business','saved@example.test','+17195550100');
insert into public.ops_service_addresses(id,customer_id,street_1,city,state,zip_code) values('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003','1 Saved St','Palmer Lake','CO','80133');
-- An older measured estimate/line is authoritative history and stays unchanged.
insert into public.ops_appointments(id,customer_id,service_address_id,appointment_date,start_time,end_time,status,kind,estimate_status,quoted_total)
values('90000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004',current_date-30,'09:00','11:00','completed','estimate','sent',675);
insert into public.ops_appointment_line_items(id,appointment_id,name_snapshot,quantity,unit_price)
values('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001','Measured fixture carpet',1500,0.45);
create function public.test_measurement_input(p_operation integer, p_account integer default 2) returns jsonb language sql as $$
 select jsonb_build_object('operation_key','20000000-0000-4000-8000-'||lpad(p_operation::text,12,'0'), 'account_id','30000000-0000-4000-8000-'||lpad(p_account::text,12,'0'),
 'identity',jsonb_build_object('mode','existing','customer_id','10000000-0000-4000-8000-000000000003','service_address_id','10000000-0000-4000-8000-000000000004'),
 'appointment_date',(current_date+7)::text,'start_time','09:00','assigned_staff_user_id','10000000-0000-4000-8000-000000000005','visit_duration_minutes',60,'job_description','Fixture measuring only');
$$;

set role service_role;
do $$ declare request jsonb := public.test_measurement_input(1); snapshot jsonb; result jsonb; again jsonb; begin
 snapshot := public.preview_outreach_measurement_context((request->>'appointment_date')::date,request->'identity');
 result := public.confirm_outreach_measurement(request,snapshot->>'version',now()+interval '10 minutes',true);
 if result->>'status' <> 'confirmed' then raise exception 'Confirmation failed: %',result; end if;
 again := public.confirm_outreach_measurement(request,'old',now()-interval '1 day',false);
 if again <> result then raise exception 'Replay did not recover exact receipt'; end if;
 if result->'receipt'->>'end_time' <> '11:00' then raise exception 'Incorrect buffer'; end if;
 if not exists(select 1 from public.ops_appointments where id=(result->'receipt'->>'appointment_id')::uuid and kind='estimate' and estimate_status='draft' and quoted_total=0 and quickbooks_sync_status='held') then raise exception 'Not a held measuring estimate'; end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.ops_appointments) <> 2 or exists(select 1 from public.ops_invoices) or (select count(*) from public.ops_appointment_line_items)<>1 then raise exception 'Unexpected side effects'; end if;
 if (select full_name from public.ops_customers where id='10000000-0000-4000-8000-000000000003') <> 'Saved Contact' then raise exception 'Customer was overwritten'; end if;
end $$;

set role service_role;
do $$ declare request jsonb:=public.test_measurement_input(2,3); snapshot jsonb; result jsonb; begin
 snapshot:=public.preview_outreach_measurement_context((request->>'appointment_date')::date,request->'identity');
 result:=public.confirm_outreach_measurement(request,snapshot->>'version',now()-interval '1 minute',true);
 if result->>'status'<>'rejected' or result->>'definitive'<>'true' then raise exception 'Expiry not definitive'; end if;
 if public.confirm_outreach_measurement(request,snapshot->>'version',now()+interval '10 minutes',true)<>result then raise exception 'Rejected key later booked'; end if;
 request:=public.test_measurement_input(3,4);
 result:=public.confirm_outreach_measurement(request,snapshot->>'version',now()+interval '10 minutes',false);
 if result->>'status'<>'rejected' then raise exception 'Disabled bridge wrote'; end if;
end $$;
reset role;

-- A manual booking/changed record after preview invalidates the whole request.
do $$ declare request jsonb:=public.test_measurement_input(4,5); snapshot jsonb; result jsonb; begin
 snapshot:=public.preview_outreach_measurement_context((request->>'appointment_date')::date,request->'identity');
 update public.ops_customers set full_name='Edited Contact',updated_at=now()+interval '1 second' where id='10000000-0000-4000-8000-000000000003';
 result:=public.confirm_outreach_measurement(request,snapshot->>'version',now()+interval '10 minutes',true);
 if result->>'status'<>'rejected' or result->>'code'<>'STALE_PREVIEW' then raise exception 'Stale context accepted: %',result; end if;
end $$;

-- Even a fresh token cannot silently create another active visit for this account.
do $$ declare request jsonb:=public.test_measurement_input(5); snapshot jsonb; result jsonb; begin
 snapshot:=public.preview_outreach_measurement_context((request->>'appointment_date')::date,request->'identity');
 result:=public.confirm_outreach_measurement(request,snapshot->>'version',now()+interval '10 minutes',true);
 if result->>'status'<>'rejected' then raise exception 'Duplicate active account visit'; end if;
end $$;

-- Fresh new prospect creates exactly one identity/site/estimate/receipt atomically.
do $$ declare request jsonb:=public.test_measurement_input(6,6); snapshot jsonb; result jsonb; begin
 request:=jsonb_set(request,'{identity}','{"mode":"new_customer","customer":{"business_name":"New Fixture Business","contact_name":"New Fixture Contact","email":"new@example.test","phone":"+17195550101"},"site":{"street_1":"2 Fixture St","street_2":"","city":"Palmer Lake","state":"CO","zip_code":"80133"}}');
 request:=jsonb_set(request,'{start_time}','"13:00"');
 snapshot:=public.preview_outreach_measurement_context((request->>'appointment_date')::date,request->'identity');
 result:=public.confirm_outreach_measurement(request,snapshot->>'version',now()+interval '10 minutes',true);
 if result->>'status'<>'confirmed' then raise exception 'New prospect failed: %',result; end if;
 if not exists(select 1 from public.ops_customers where id=(result->'receipt'->>'customer_id')::uuid and is_commercial=true and full_name='New Fixture Contact') then raise exception 'Prospect missing'; end if;
end $$;

-- Failure after prospect/site creation rolls everything back before rejection.
create function public.fail_measurement_fixture() returns trigger language plpgsql as $$ begin if new.source='Outreach measuring bridge' and new.start_time='15:00' then raise exception 'Forced late fixture failure'; end if; return new; end $$;
create trigger fail_measurement_fixture before insert on public.ops_appointments for each row execute function public.fail_measurement_fixture();
do $$ declare request jsonb:=public.test_measurement_input(7,7); snapshot jsonb; result jsonb; begin
 request:=jsonb_set(request,'{identity}','{"mode":"new_customer","customer":{"business_name":"Rollback Fixture","contact_name":"Rollback Contact","phone":"+17195550102"},"site":{"street_1":"3 Fixture St","city":"Palmer Lake","state":"CO","zip_code":"80133"}}');
 request:=jsonb_set(request,'{start_time}','"15:00"');
 snapshot:=public.preview_outreach_measurement_context((request->>'appointment_date')::date,request->'identity');
 result:=public.confirm_outreach_measurement(request,snapshot->>'version',now()+interval '10 minutes',true);
 if result->>'status'<>'rejected' or exists(select 1 from public.ops_customers where business_name='Rollback Fixture') or exists(select 1 from public.ops_service_addresses where street_1='3 Fixture St') then raise exception 'Partial customer/site survived failure'; end if;
end $$;

-- Identity matching uses normalized numbers and is never permission to overwrite.
do $$ declare request jsonb:=public.test_measurement_input(8,8); snapshot jsonb; result jsonb; begin
 request:=jsonb_set(request,'{identity}','{"mode":"new_customer","customer":{"business_name":"Duplicate","contact_name":"Wrong Branch","phone":"719-555-0100"},"site":{"street_1":"4 Fixture St","city":"Palmer Lake","state":"CO","zip_code":"80133"}}');
 snapshot:=public.preview_outreach_measurement_context((request->>'appointment_date')::date,request->'identity');
 if jsonb_array_length(snapshot->'context'->'customers')<>1 then raise exception 'Normalized match not found'; end if;
 result:=public.confirm_outreach_measurement(request,snapshot->>'version',now()+interval '10 minutes',true);
 if result->>'status'<>'rejected' then raise exception 'Duplicate prospect accepted'; end if;
end $$;

do $$ begin
 if not exists(select 1 from public.ops_appointment_line_items where id='90000000-0000-4000-8000-000000000002' and quantity=1500 and unit_price=0.45 and name_snapshot='Measured fixture carpet')
 or not exists(select 1 from public.ops_appointments where id='90000000-0000-4000-8000-000000000001' and quoted_total=675 and estimate_status='sent') then raise exception 'Authoritative measured estimate changed'; end if;
end $$;

-- Neither anonymous nor logged-in web clients can call the bridge RPCs/read receipts.
do $$ begin
 if has_function_privilege('anon','public.confirm_outreach_measurement(jsonb,text,timestamptz,boolean)','execute') or has_function_privilege('authenticated','public.preview_outreach_measurement_context(date,jsonb)','execute') or has_table_privilege('authenticated','public.outreach_measurement_receipts','select') then raise exception 'Bridge privilege leak'; end if;
 if (select count(*) from public.ops_appointments)<>3 or (select count(*) from public.ops_customers)<>2 or (select count(*) from public.ops_service_addresses)<>2 then raise exception 'Unexpected final fixture counts'; end if;
end $$;
