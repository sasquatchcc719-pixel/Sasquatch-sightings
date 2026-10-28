-- A marketing unsubscribe must not disable invoices or account communications.
CREATE TABLE public.email_marketing_suppressions (
  email text PRIMARY KEY,
  customer_id uuid REFERENCES public.ops_customers(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('unsubscribe_link', 'owner_request', 'admin')),
  source_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_marketing_suppressions_normalized_email CHECK (
    email = lower(btrim(email))
    AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
);

ALTER TABLE public.email_marketing_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_marketing_suppressions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_marketing_suppressions TO service_role;

CREATE FUNCTION public.unsubscribe_email_marketing(
  p_customer_id uuid,
  p_source text,
  p_source_message_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_current_email text;
  v_inserted integer;
  v_affected_customers integer;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('unsubscribe_link', 'owner_request', 'admin') THEN
    RAISE EXCEPTION 'Invalid marketing unsubscribe source' USING ERRCODE = '22023';
  END IF;

  SELECT lower(btrim(email)) INTO v_email
  FROM public.ops_customers
  WHERE id = p_customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Customer has no valid saved email' USING ERRCODE = '22023';
  END IF;

  -- Different customer records for the same mailbox share one preference.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('email_marketing:' || v_email, 0)
  );
  SELECT lower(btrim(email)) INTO v_current_email
  FROM public.ops_customers
  WHERE id = p_customer_id
  FOR UPDATE;
  IF NOT FOUND OR v_current_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'Customer email changed; retry the unsubscribe' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.email_marketing_suppressions(email, customer_id, source, source_message_id)
  VALUES (v_email, p_customer_id, p_source, p_source_message_id)
  ON CONFLICT (email) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT count(*) INTO v_affected_customers
  FROM public.ops_customers
  WHERE lower(btrim(email)) = v_email;

  UPDATE public.drip_campaign_enrollments
  SET status = 'unsubscribed', updated_at = now()
  WHERE status = 'active'
    AND customer_id IN (
      SELECT id FROM public.ops_customers WHERE lower(btrim(email)) = v_email
    );

  UPDATE public.reactivation_campaign_enrollments
  SET status = 'suppressed_unsubscribed',
      next_send_at = NULL,
      stop_reason = 'marketing_email_opt_out',
      updated_at = now()
  WHERE customer_id IN (
    SELECT id FROM public.ops_customers WHERE lower(btrim(email)) = v_email
  );

  IF v_inserted = 1 THEN
    INSERT INTO public.reactivation_email_log(customer_id, event_type, status, metadata)
    VALUES (
      p_customer_id,
      'unsubscribed',
      'logged',
      pg_catalog.jsonb_build_object(
        'source', p_source,
        'source_message_id', p_source_message_id,
        'scope', 'marketing_only'
      )
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'already_unsubscribed', v_inserted = 0,
    'affected_customers', v_affected_customers
  );
END;
$$;

REVOKE ALL ON FUNCTION public.unsubscribe_email_marketing(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unsubscribe_email_marketing(uuid, text, text) TO service_role;
