-- A verified receipt exists only if the job, draft invoice and lines all commit.
alter table public.ops_appointments
  add column phone_assistant_call_sid text unique references public.phone_assistant_sessions(call_sid) on delete set null,
  add column phone_assistant_request_hash text;

create function public.create_phone_appointment(p_sid text, p_hash text, p_plan jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  session_row public.phone_assistant_sessions%rowtype;
  existing public.ops_appointments%rowtype;
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
revoke all on function public.create_phone_appointment(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_phone_appointment(text,text,jsonb) to service_role;
