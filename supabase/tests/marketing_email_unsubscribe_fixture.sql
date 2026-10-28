-- Isolated PostgreSQL/PGlite fixture. Never execute against a real database.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.ops_customers (
  id uuid PRIMARY KEY,
  email text,
  email_opt_out boolean NOT NULL DEFAULT false
);
CREATE TABLE public.drip_campaign_enrollments (
  id uuid PRIMARY KEY,
  customer_id uuid REFERENCES public.ops_customers(id),
  status text NOT NULL CHECK (status IN ('active', 'completed', 'unsubscribed', 'cancelled')),
  next_send_at date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.reactivation_campaign_enrollments (
  id uuid PRIMARY KEY,
  customer_id uuid REFERENCES public.ops_customers(id),
  status text NOT NULL,
  next_send_at date,
  stop_reason text,
  messages_sent integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz,
  manual_suppressed_at timestamptz,
  manual_suppression_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.reactivation_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.ops_customers(id),
  event_type text NOT NULL,
  status text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;

INSERT INTO public.ops_customers(id, email, email_opt_out) VALUES
('00000000-0000-4000-8000-000000000001', '  Test@Example.com  ', false),
('00000000-0000-4000-8000-000000000002', 'test@example.com', true),
('00000000-0000-4000-8000-000000000003', 'other@example.com', false),
('00000000-0000-4000-8000-000000000004', 'rollback@example.com', false),
('00000000-0000-4000-8000-000000000005', NULL, false),
('00000000-0000-4000-8000-000000000006', 'not an email', false);

INSERT INTO public.drip_campaign_enrollments(id, customer_id, status, next_send_at)
SELECT id, id, 'active', '2026-10-29'::date FROM public.ops_customers
WHERE id <= '00000000-0000-4000-8000-000000000004';
INSERT INTO public.drip_campaign_enrollments(id, customer_id, status, next_send_at)
VALUES ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'completed', '2026-09-01');
INSERT INTO public.reactivation_campaign_enrollments(
  id, customer_id, status, next_send_at, messages_sent, last_sent_at,
  manual_suppressed_at, manual_suppression_reason
)
SELECT id, id,
  CASE WHEN id = '00000000-0000-4000-8000-000000000002' THEN 'paused_recent_booking' ELSE 'active' END,
  '2026-10-29'::date, 3, '2026-09-29T15:31:00Z'::timestamptz,
  '2026-09-01T00:00:00Z'::timestamptz, 'preserve me'
FROM public.ops_customers WHERE id <= '00000000-0000-4000-8000-000000000004';

-- APPLY_MARKETING_EMAIL_UNSUBSCRIBE_MIGRATION_HERE

SET ROLE service_role;
DO $$
DECLARE result jsonb;
BEGIN
  result := public.unsubscribe_email_marketing(
    '00000000-0000-4000-8000-000000000001', 'owner_request', 'inbound-message-123'
  );
  IF result <> '{"success":true,"already_unsubscribed":false,"affected_customers":2}'::jsonb THEN
    RAISE EXCEPTION 'Unexpected first unsubscribe receipt: %', result;
  END IF;
  result := public.unsubscribe_email_marketing(
    '00000000-0000-4000-8000-000000000002', 'unsubscribe_link'
  );
  IF result <> '{"success":true,"already_unsubscribed":true,"affected_customers":2}'::jsonb THEN
    RAISE EXCEPTION 'Unexpected repeat unsubscribe receipt: %', result;
  END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.email_marketing_suppressions) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.email_marketing_suppressions
      WHERE email = 'test@example.com'
        AND customer_id = '00000000-0000-4000-8000-000000000001'
        AND source = 'owner_request' AND source_message_id = 'inbound-message-123'
    ) THEN RAISE EXCEPTION 'Normalized suppression or first provenance changed'; END IF;
  IF (SELECT count(*) FROM public.reactivation_email_log) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.reactivation_email_log
      WHERE event_type = 'unsubscribed' AND status = 'logged'
        AND metadata = '{"source":"owner_request","source_message_id":"inbound-message-123","scope":"marketing_only"}'::jsonb
    ) THEN RAISE EXCEPTION 'Unsubscribe audit was duplicated or provenance missing'; END IF;
  IF (SELECT email_opt_out FROM public.ops_customers WHERE id = '00000000-0000-4000-8000-000000000001')
    OR NOT (SELECT email_opt_out FROM public.ops_customers WHERE id = '00000000-0000-4000-8000-000000000002')
    THEN RAISE EXCEPTION 'Broad email preferences changed'; END IF;
  IF (SELECT count(*) FROM public.drip_campaign_enrollments WHERE status = 'unsubscribed') <> 2
    OR EXISTS (SELECT 1 FROM public.drip_campaign_enrollments WHERE next_send_at IS NULL)
    OR (SELECT status FROM public.drip_campaign_enrollments WHERE id = '00000000-0000-4000-8000-000000000101') <> 'completed'
    THEN RAISE EXCEPTION 'Active duplicate drip suppression or completed state incorrect'; END IF;
  IF (SELECT count(*) FROM public.reactivation_campaign_enrollments
      WHERE status = 'suppressed_unsubscribed' AND next_send_at IS NULL AND stop_reason = 'marketing_email_opt_out') <> 2
    THEN RAISE EXCEPTION 'Duplicate reactivation enrollments were not stopped'; END IF;
  IF EXISTS (SELECT 1 FROM public.reactivation_campaign_enrollments
      WHERE messages_sent <> 3 OR last_sent_at <> '2026-09-29T15:31:00Z'::timestamptz
        OR manual_suppressed_at <> '2026-09-01T00:00:00Z'::timestamptz OR manual_suppression_reason <> 'preserve me')
    THEN RAISE EXCEPTION 'Historical send/override provenance changed'; END IF;
  IF (SELECT status FROM public.drip_campaign_enrollments WHERE customer_id = '00000000-0000-4000-8000-000000000003') <> 'active'
    OR (SELECT status FROM public.reactivation_campaign_enrollments WHERE customer_id = '00000000-0000-4000-8000-000000000003') <> 'active'
    THEN RAISE EXCEPTION 'Unrelated recipient changed'; END IF;
END;
$$;

-- Force the final audit insert to fail: prior ledger/enrollment writes must roll back.
CREATE FUNCTION public.reject_fixture_unsubscribe_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id = '00000000-0000-4000-8000-000000000004' THEN
    RAISE EXCEPTION 'Fixture final audit failure' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reject_fixture_unsubscribe_log BEFORE INSERT ON public.reactivation_email_log
FOR EACH ROW EXECUTE FUNCTION public.reject_fixture_unsubscribe_log();

SET ROLE service_role;
DO $$
BEGIN
  BEGIN
    PERFORM public.unsubscribe_email_marketing('00000000-0000-4000-8000-000000000004', 'admin');
    RAISE EXCEPTION 'Expected final audit failure';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.email_marketing_suppressions WHERE email = 'rollback@example.com')
    OR (SELECT status FROM public.drip_campaign_enrollments WHERE customer_id = '00000000-0000-4000-8000-000000000004') <> 'active'
    OR (SELECT status FROM public.reactivation_campaign_enrollments WHERE customer_id = '00000000-0000-4000-8000-000000000004') <> 'active'
    THEN RAISE EXCEPTION 'Failure did not roll back the full unsubscribe'; END IF;

  BEGIN
    PERFORM public.unsubscribe_email_marketing('00000000-0000-4000-8000-000000000099', 'admin');
    RAISE EXCEPTION 'Missing customer was accepted';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.unsubscribe_email_marketing('00000000-0000-4000-8000-000000000005', 'admin');
    RAISE EXCEPTION 'Empty email was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.unsubscribe_email_marketing('00000000-0000-4000-8000-000000000006', 'admin');
    RAISE EXCEPTION 'Invalid email was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.unsubscribe_email_marketing('00000000-0000-4000-8000-000000000003', 'untrusted');
    RAISE EXCEPTION 'Invalid provenance source was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF (SELECT count(*) FROM public.email_marketing_suppressions) <> 1
    OR (SELECT count(*) FROM public.reactivation_email_log) <> 1 THEN
    RAISE EXCEPTION 'Rejected calls left durable writes';
  END IF;
END;
$$;
RESET ROLE;

DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(role_name, 'public.email_marketing_suppressions', 'SELECT,INSERT,UPDATE,DELETE')
      OR has_function_privilege(role_name, 'public.unsubscribe_email_marketing(uuid,text,text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'Public role % has access to marketing preferences', role_name;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.email_marketing_suppressions', 'SELECT,INSERT,UPDATE,DELETE')
    OR NOT has_function_privilege('service_role', 'public.unsubscribe_email_marketing(uuid,text,text)', 'EXECUTE')
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_marketing_suppressions'::regclass)
    OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.unsubscribe_email_marketing(uuid,text,text)'::regprocedure)
    OR NOT (SELECT 'search_path=""' = ANY(proconfig) FROM pg_proc WHERE oid = 'public.unsubscribe_email_marketing(uuid,text,text)'::regprocedure)
    THEN RAISE EXCEPTION 'Service-only invoker/RLS protections missing'; END IF;
END;
$$;

-- Deleting a customer must retain the normalized-email suppression.
DELETE FROM public.drip_campaign_enrollments WHERE customer_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM public.reactivation_campaign_enrollments WHERE customer_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM public.reactivation_email_log WHERE customer_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM public.ops_customers WHERE id = '00000000-0000-4000-8000-000000000001';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.email_marketing_suppressions WHERE email = 'test@example.com' AND customer_id IS NULL)
    THEN RAISE EXCEPTION 'Customer deletion lost suppression'; END IF;
END;
$$;
