-- Commercial profiles and versioned agreements. Access stays behind scoped APIs.
CREATE TABLE public.ops_commercial_profiles (
  customer_id uuid PRIMARY KEY REFERENCES public.ops_customers(id),
  legal_name text NOT NULL DEFAULT '',
  billing_contact text NOT NULL DEFAULT '',
  billing_email text NOT NULL DEFAULT '',
  purchase_order text NOT NULL DEFAULT '',
  access_instructions text NOT NULL DEFAULT '',
  service_windows text NOT NULL DEFAULT '',
  site_notes text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ops_commercial_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.ops_customers(id),
  source_estimate_id uuid REFERENCES public.ops_appointments(id),
  previous_version_id uuid REFERENCES public.ops_commercial_agreements(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','signed','withdrawn')),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  content_hash text,
  published_by uuid REFERENCES auth.users(id),
  published_at timestamptz,
  signed_by uuid REFERENCES auth.users(id),
  signed_name text,
  signed_title text,
  signed_email text,
  signed_at timestamptz,
  signature_consent text,
  signature_ip text,
  signature_user_agent text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('published','signed') OR (content_hash IS NOT NULL AND published_at IS NOT NULL AND published_by IS NOT NULL)),
  CHECK (status <> 'signed' OR (signed_by IS NOT NULL AND signed_name IS NOT NULL AND signed_title IS NOT NULL AND signed_email IS NOT NULL AND signed_at IS NOT NULL AND signature_consent IS NOT NULL))
);
CREATE INDEX ON public.ops_commercial_agreements(customer_id, created_at DESC);
CREATE UNIQUE INDEX commercial_agreement_one_revision ON public.ops_commercial_agreements(previous_version_id) WHERE previous_version_id IS NOT NULL;
ALTER TABLE public.ops_client_users ADD COLUMN can_sign_agreements boolean NOT NULL DEFAULT false;
ALTER TABLE public.ops_commercial_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_commercial_agreements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_commercial_profiles, public.ops_commercial_agreements FROM anon, authenticated;
GRANT ALL ON public.ops_commercial_profiles, public.ops_commercial_agreements TO service_role;

CREATE FUNCTION public.guard_commercial_agreement() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Agreements are retained; withdraw a published agreement instead';
  END IF;
  IF OLD.status IN ('signed','withdrawn') THEN
    RAISE EXCEPTION 'This agreement is immutable; create a new version';
  END IF;
  IF NEW.customer_id <> OLD.customer_id OR NEW.previous_version_id IS DISTINCT FROM OLD.previous_version_id
     OR NEW.source_estimate_id IS DISTINCT FROM OLD.source_estimate_id OR NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'Agreement ownership and lineage cannot change';
  END IF;
  IF OLD.status = 'published' THEN
    IF NEW.status NOT IN ('signed','withdrawn') OR NEW.content IS DISTINCT FROM OLD.content
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.published_by IS DISTINCT FROM OLD.published_by THEN
      RAISE EXCEPTION 'Published terms are immutable; create a new version';
    END IF;
  ELSIF NEW.status NOT IN ('draft','published') THEN
    RAISE EXCEPTION 'Publish the agreement before signing';
  END IF;
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_commercial_agreement() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_commercial_agreement BEFORE UPDATE OR DELETE ON public.ops_commercial_agreements
FOR EACH ROW EXECUTE FUNCTION public.guard_commercial_agreement();

ALTER TABLE public.ops_recurring_templates ADD COLUMN commercial_agreement_id uuid REFERENCES public.ops_commercial_agreements(id);
CREATE INDEX ON public.ops_recurring_templates(commercial_agreement_id) WHERE commercial_agreement_id IS NOT NULL;
-- Atomically save a paused service plan and its date rule. Generating visits is a separate explicit action.
CREATE FUNCTION public.create_commercial_service_plan(p_id uuid, p_agreement_id uuid, p_template jsonb, p_rule jsonb)
RETURNS uuid LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE a public.ops_commercial_agreements; existing_id uuid;
BEGIN
  SELECT * INTO a FROM public.ops_commercial_agreements WHERE id = p_agreement_id AND status = 'signed';
  IF NOT FOUND THEN RAISE EXCEPTION 'A signed agreement is required'; END IF;
  SELECT id INTO existing_id FROM public.ops_recurring_templates WHERE id = p_id AND commercial_agreement_id = p_agreement_id;
  IF existing_id IS NOT NULL THEN RETURN existing_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ops_service_addresses WHERE id = (p_template->>'service_address_id')::uuid AND customer_id = a.customer_id) THEN
    RAISE EXCEPTION 'Service address does not belong to agreement customer';
  END IF;
  INSERT INTO public.ops_recurring_templates(id, customer_id, service_address_id, label, line_items, start_time,
    scheduled_duration_minutes, invoice_mode, is_active, commercial_agreement_id)
  VALUES (p_id, a.customer_id, (p_template->>'service_address_id')::uuid, p_template->>'label', p_template->'line_items',
    (p_template->>'start_time')::time, (p_template->>'scheduled_duration_minutes')::int, p_template->>'invoice_mode', false, a.id);
  INSERT INTO public.ops_recurrence_rules(template_id, frequency, day_of_week, day_of_month, interval_days, effective_from, effective_until)
  VALUES (p_id, p_rule->>'frequency', (p_rule->>'day_of_week')::int, (p_rule->>'day_of_month')::int,
    (p_rule->>'interval_days')::int, (p_rule->>'effective_from')::date, (p_rule->>'effective_until')::date);
  RETURN p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_commercial_service_plan(uuid,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_commercial_service_plan(uuid,uuid,jsonb,jsonb) TO service_role;
