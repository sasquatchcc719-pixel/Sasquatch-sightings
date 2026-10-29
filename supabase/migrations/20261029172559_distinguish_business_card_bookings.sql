-- Card-page checkouts and customer-reported business-card acquisition are
-- separate from ordinary website checkouts and location-partner placards.
INSERT INTO public.lead_source_options
  (source_key, customer_label, internal_label, reporting_category,
   display_order, is_active, is_public, requires_detail, detail_label)
VALUES
  ('business_card', 'Business card', 'Business card', 'offline',
   127, true, true, false, null)
ON CONFLICT (source_key) DO NOTHING;

-- These four existing public checkouts explicitly retained the old widget's
-- NFC Card marker. Do not infer a card from a nearby scan or shared coupon.
UPDATE public.ops_appointments
SET booking_channel = 'business_card',
    original_lead_source = COALESCE(original_lead_source, lead_source),
    lead_source = 'Business card',
    lead_source_key = 'business_card'
WHERE created_at < '2026-10-29 17:19:00+00'::timestamptz
AND booking_channel = 'website'
AND source = 'website'
AND lead_source_key = 'nfc_partner'
AND lower(trim(lead_source_detail)) = 'nfc card'
AND partner_id IS NULL
AND NOT EXISTS (
  SELECT 1 FROM public.nfc_card_taps t
  WHERE t.appointment_id = ops_appointments.id AND t.partner_id IS NOT NULL
);

-- Preserve the same database collision guard for card-page checkouts.
-- Keep automatic/public booking guards; allow an explicit staff admin override
-- without changing the appointment's original booking channel.
create or replace function public.prevent_ai_ops_appointment_overlap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Only the server's transaction-scoped admin override may bypass conflicts.
  if current_user = 'service_role'
     and current_setting('app.admin_schedule_override', true) = 'on'
  then
    return new;
  end if;

  -- Status / notes / timestamps only — do not re-litigate schedule conflicts.
  if tg_op = 'UPDATE'
     and new.appointment_date is not distinct from old.appointment_date
     and new.start_time is not distinct from old.start_time
     and new.end_time is not distinct from old.end_time
     and new.assigned_staff_user_id is not distinct from old.assigned_staff_user_id
  then
    return new;
  end if;

  -- Outside crews do not occupy our schedule.
  if coalesce(new.is_subcontracted, false) then
    return new;
  end if;

  if new.booking_channel not in ('ai_agent', 'sms_harry', 'lsa_sms', 'retell_rabecca', 'website', 'business_card') then
    return new;
  end if;

  if new.status not in ('booked', 'confirmed', 'on_my_way', 'in_progress', 'pending_approval') then
    return new;
  end if;

  if exists (
    select 1
    from public.ops_appointments existing
    where existing.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and existing.appointment_date = new.appointment_date
      and coalesce(existing.is_subcontracted, false) = false
      and existing.status in ('booked', 'confirmed', 'on_my_way', 'in_progress', 'pending_approval')
      and (
        existing.assigned_staff_user_id is null
        or new.assigned_staff_user_id is null
        or existing.assigned_staff_user_id = new.assigned_staff_user_id
      )
      and new.start_time < existing.end_time
      and new.end_time > existing.start_time
  ) then
    raise exception 'Appointment overlaps an active appointment for that staff schedule. Check live availability before booking.'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.ops_calendar_events event
    where event.event_kind = 'block'
      and event.start_date <= new.appointment_date
      and event.end_date >= new.appointment_date
      and (
        event.assigned_staff_user_id is null
        or new.assigned_staff_user_id is null
        or event.assigned_staff_user_id = new.assigned_staff_user_id
        or event.assigned_staff_user_id = (
          select staff.user_id
          from public.staff_users staff
          where staff.id = new.assigned_staff_user_id
        )
      )
      and new.start_time < case
        when event.is_all_day or event.end_time is null then time '23:59:59'
        when new.appointment_date < event.end_date then time '23:59:59'
        else event.end_time
      end
      and new.end_time > case
        when event.is_all_day or event.start_time is null then time '00:00:00'
        when new.appointment_date > event.start_date then time '00:00:00'
        else event.start_time
      end
  ) then
    raise exception 'Appointment overlaps blocked schedule time for that staff schedule. Check live availability before booking.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

