-- Existing records retain their charges and use a stable fallback until saved.
alter table public.ops_appointment_line_items add column if not exists sort_order integer;
alter table public.ops_invoice_line_items add column if not exists sort_order integer;

-- Preserve edited order when converting an estimate to a job and invoice.
CREATE OR REPLACE FUNCTION public.mcp_convert_estimate(p_estimate_id uuid, p_expected_updated_at timestamp with time zone, p_expected_status text, p_appointment_date date, p_start_time time without time zone, p_end_time time without time zone, p_assigned_staff_user_id uuid, p_discount_amount numeric, p_actor_user_id uuid, p_sync_status text, p_allow_conflict boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    area_segments,
    sort_order
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
    source.area_segments,
    (row_number() over (order by source.sort_order nulls last, source.created_at, source.id) - 1)::integer
  from public.ops_appointment_line_items source
  where source.appointment_id = p_estimate_id
  order by source.sort_order nulls last, source.created_at, source.id;

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
    line_total,
    sort_order
  )
  select
    invoice_id,
    line.id,
    line.name_snapshot,
    line.quantity,
    line.unit_price,
    line.line_total,
    line.sort_order
  from public.ops_appointment_line_items line
  where line.appointment_id = service_appointment_id
  order by line.sort_order nulls last, line.created_at, line.id;

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
$function$
;
