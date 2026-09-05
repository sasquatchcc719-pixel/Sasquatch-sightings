ALTER TABLE public.ops_recurring_templates
  ADD COLUMN IF NOT EXISTS assigned_staff_user_id uuid
  REFERENCES public.staff_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recurring_templates_assigned_staff
  ON public.ops_recurring_templates(assigned_staff_user_id)
  WHERE assigned_staff_user_id IS NOT NULL;

-- Commercial plans are created paused, but they still need an owner before
-- the dates can be previewed safely or generated onto the live calendar.
CREATE OR REPLACE FUNCTION public.create_commercial_service_plan(
  p_id uuid,
  p_agreement_id uuid,
  p_template jsonb,
  p_rule jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  a public.ops_commercial_agreements;
  existing_id uuid;
BEGIN
  SELECT * INTO a
  FROM public.ops_commercial_agreements
  WHERE id = p_agreement_id AND status = 'signed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A signed agreement is required';
  END IF;

  SELECT id INTO existing_id
  FROM public.ops_recurring_templates
  WHERE id = p_id AND commercial_agreement_id = p_agreement_id;

  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.ops_service_addresses
    WHERE id = (p_template->>'service_address_id')::uuid
      AND customer_id = a.customer_id
  ) THEN
    RAISE EXCEPTION 'Service address does not belong to agreement customer';
  END IF;

  INSERT INTO public.ops_recurring_templates(
    id,
    customer_id,
    service_address_id,
    label,
    line_items,
    start_time,
    scheduled_duration_minutes,
    invoice_mode,
    is_active,
    commercial_agreement_id,
    assigned_staff_user_id
  )
  VALUES (
    p_id,
    a.customer_id,
    (p_template->>'service_address_id')::uuid,
    p_template->>'label',
    p_template->'line_items',
    (p_template->>'start_time')::time,
    (p_template->>'scheduled_duration_minutes')::int,
    p_template->>'invoice_mode',
    false,
    a.id,
    NULLIF(p_template->>'assigned_staff_user_id', '')::uuid
  );

  INSERT INTO public.ops_recurrence_rules(
    template_id,
    frequency,
    day_of_week,
    day_of_month,
    interval_days,
    effective_from,
    effective_until
  )
  VALUES (
    p_id,
    p_rule->>'frequency',
    (p_rule->>'day_of_week')::int,
    (p_rule->>'day_of_month')::int,
    (p_rule->>'interval_days')::int,
    (p_rule->>'effective_from')::date,
    (p_rule->>'effective_until')::date
  );

  RETURN p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_commercial_service_plan(uuid, uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_commercial_service_plan(uuid, uuid, jsonb, jsonb)
  TO service_role;
