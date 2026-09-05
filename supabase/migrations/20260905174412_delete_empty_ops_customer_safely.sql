-- Permanently remove an empty/test customer without risking operational history.
-- The caller must use the service role; staff authorization lives in the API route.
create or replace function public.delete_empty_ops_customer(p_customer_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_customer public.ops_customers%rowtype;
  v_appointment_count bigint;
  v_agreement_count bigint;
  v_concern_count bigint;
  v_restoration_count bigint;
  v_portal_user_ids jsonb;
begin
  select *
  into v_customer
  from public.ops_customers
  where id = p_customer_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Customer not found';
  end if;

  select count(*) into v_appointment_count
  from public.ops_appointments
  where customer_id = p_customer_id;

  select count(*) into v_agreement_count
  from public.ops_commercial_agreements
  where customer_id = p_customer_id;

  select count(*) into v_concern_count
  from public.ops_service_concerns
  where customer_id = p_customer_id;

  select count(*) into v_restoration_count
  from public.restoration_projects
  where customer_id = p_customer_id;

  if v_appointment_count + v_agreement_count + v_concern_count + v_restoration_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Customer has protected operational history and cannot be permanently deleted';
  end if;

  select coalesce(jsonb_agg(user_id), '[]'::jsonb)
  into v_portal_user_ids
  from public.ops_client_users
  where customer_id = p_customer_id;

  -- Commercial profiles use NO ACTION because they normally outlive edits. It is
  -- safe to remove the profile only after the protected-history checks above pass.
  delete from public.ops_commercial_profiles
  where customer_id = p_customer_id;

  -- Existing foreign keys cascade disposable setup rows and detach retained logs.
  -- The ops_deleted_records triggers preserve the customer and address rows.
  delete from public.ops_customers
  where id = p_customer_id;

  return jsonb_build_object(
    'id', p_customer_id,
    'label', coalesce(nullif(v_customer.business_name, ''), v_customer.full_name),
    'portal_user_ids', v_portal_user_ids
  );
end;
$$;

revoke all on function public.delete_empty_ops_customer(uuid) from public, anon, authenticated;
grant execute on function public.delete_empty_ops_customer(uuid) to service_role;
