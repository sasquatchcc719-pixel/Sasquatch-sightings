-- Transactional fixtures: no real appointments or notifications are created.
begin;

insert into public.ops_customers (id, full_name, phone)
values
  ('b1000000-0000-4000-8000-000000000001', 'Blacklist regression', '+17195550191'),
  ('b1000000-0000-4000-8000-000000000002', 'Allowed regression', '+17195550192');
insert into public.blacklist (name, phone)
values ('Blacklist regression', '+1 (719) 555-0191');

create temporary table blacklist_booking_fixture (
  id int generated always as identity,
  customer_id uuid,
  status text default 'booked',
  booking_channel text,
  appointment_date date default '2099-01-01',
  start_time time default '09:00',
  end_time time default '10:00'
);
create trigger enforce_fixture
before insert or update on blacklist_booking_fixture
for each row execute function public.prevent_blacklisted_appointment();

do $test$
declare
  v_phone text;
  v_channel text;
begin
  foreach v_phone in array array['7195550191', '+17195550191', '(719) 555-0191'] loop
    if not public.is_phone_blacklisted(v_phone) then
      raise exception 'Normalized blacklist match failed: %', v_phone;
    end if;
  end loop;
  if public.is_phone_blacklisted('7195550192')
    or public.is_phone_blacklisted('')
    or public.is_phone_blacklisted(null) then
    raise exception 'Unblocked or empty phone falsely blocked';
  end if;

  foreach v_channel in array array['admin', 'website', 'website_chat', 'lsa_sms', 'recurring'] loop
    begin
      insert into blacklist_booking_fixture (customer_id, booking_channel)
      values ('b1000000-0000-4000-8000-000000000001', v_channel);
      raise exception using errcode = 'P9999', message = 'Blacklisted booking was allowed';
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'This customer is blacklisted and cannot book appointments.' then raise; end if;
    end;
  end loop;

  insert into blacklist_booking_fixture (customer_id, booking_channel)
  values ('b1000000-0000-4000-8000-000000000002', 'admin');
  begin
    update blacklist_booking_fixture
    set customer_id = 'b1000000-0000-4000-8000-000000000001';
    raise exception using errcode = 'P9999', message = 'Reassignment to blocked customer was allowed';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'This customer is blacklisted and cannot book appointments.' then raise; end if;
  end;

  insert into blacklist_booking_fixture (customer_id, status)
  values ('b1000000-0000-4000-8000-000000000001', 'cancelled');
  begin
    update blacklist_booking_fixture set status = 'booked' where status = 'cancelled';
    raise exception using errcode = 'P9999', message = 'Reactivation of blocked booking was allowed';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'This customer is blacklisted and cannot book appointments.' then raise; end if;
  end;

  -- Model an existing job that predates the blacklist, without inserting a real job.
  alter table blacklist_booking_fixture disable trigger enforce_fixture;
  insert into blacklist_booking_fixture (customer_id, status)
  values ('b1000000-0000-4000-8000-000000000001', 'booked');
  alter table blacklist_booking_fixture enable trigger enforce_fixture;
  begin
    update blacklist_booking_fixture set appointment_date = '2099-01-02' where status = 'booked';
    raise exception using errcode = 'P9999', message = 'Blocked reschedule was allowed';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'This customer is blacklisted and cannot book appointments.' then raise; end if;
  end;
  update blacklist_booking_fixture set status = 'confirmed' where status = 'booked';
  update blacklist_booking_fixture set status = 'cancelled' where status = 'confirmed';

  if has_function_privilege('anon', 'public.is_phone_blacklisted(text)', 'execute')
    or has_function_privilege('authenticated', 'public.is_phone_blacklisted(text)', 'execute')
    or not has_function_privilege('service_role', 'public.is_phone_blacklisted(text)', 'execute') then
    raise exception 'Blacklist lookup permissions incorrect';
  end if;
end;
$test$;

rollback;
select 'Blacklist booking regression checks passed; fixtures rolled back' as result;
