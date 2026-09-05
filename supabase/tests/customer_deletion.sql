begin;

insert into public.ops_customers (
  id,
  full_name,
  business_name,
  phone,
  is_commercial
)
values (
  '11111111-1111-4111-8111-111111111111',
  'Customer deletion test',
  'Customer deletion test',
  '+17195550001',
  true
);

insert into public.ops_service_addresses (
  customer_id,
  street_1,
  city,
  state,
  zip_code
)
values (
  '11111111-1111-4111-8111-111111111111',
  '1 Test Way',
  'Colorado Springs',
  'CO',
  '80903'
);

do $test$
declare
  v_result jsonb;
begin
  select public.delete_empty_ops_customer(
    '11111111-1111-4111-8111-111111111111'
  ) into v_result;

  if v_result->>'label' <> 'Customer Deletion Test' then
    raise exception 'delete function returned the wrong customer';
  end if;

  if exists (
    select 1
    from public.ops_customers
    where id = '11111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'empty customer was not deleted';
  end if;
end;
$test$;

insert into public.ops_customers (
  id,
  full_name,
  business_name,
  phone,
  is_commercial
)
values (
  '22222222-2222-4222-8222-222222222222',
  'Protected customer deletion test',
  'Protected customer deletion test',
  '+17195550002',
  true
);

insert into public.ops_commercial_agreements (
  customer_id,
  status,
  content
)
values (
  '22222222-2222-4222-8222-222222222222',
  'draft',
  '{}'::jsonb
);

do $test$
begin
  begin
    perform public.delete_empty_ops_customer(
      '22222222-2222-4222-8222-222222222222'
    );
    raise exception using
      errcode = 'P9999',
      message = 'protected customer deletion unexpectedly succeeded';
  exception
    when sqlstate 'P0001' then null;
  end;

  if not exists (
    select 1
    from public.ops_customers
    where id = '22222222-2222-4222-8222-222222222222'
  ) then
    raise exception 'protected customer was deleted';
  end if;
end;
$test$;

rollback;
