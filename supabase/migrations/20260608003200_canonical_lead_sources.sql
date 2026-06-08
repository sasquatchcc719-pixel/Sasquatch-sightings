CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS lead_source_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT UNIQUE NOT NULL,
  customer_label TEXT NOT NULL,
  internal_label TEXT NOT NULL,
  reporting_category TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  requires_detail BOOLEAN NOT NULL DEFAULT FALSE,
  detail_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lead_source_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active public lead source options" ON lead_source_options;
CREATE POLICY "Public can read active public lead source options"
ON lead_source_options
FOR SELECT
TO anon, authenticated
USING (is_active = TRUE AND is_public = TRUE);

DROP POLICY IF EXISTS "Admins can manage lead source options" ON lead_source_options;
CREATE POLICY "Admins can manage lead source options"
ON lead_source_options
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM staff_users staff
    WHERE staff.user_id = auth.uid()
      AND staff.is_active = TRUE
      AND staff.role = 'owner'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM staff_users staff
    WHERE staff.user_id = auth.uid()
      AND staff.is_active = TRUE
      AND staff.role = 'owner'
  )
);

CREATE OR REPLACE FUNCTION set_lead_source_options_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS set_lead_source_options_updated_at ON lead_source_options;
CREATE TRIGGER set_lead_source_options_updated_at
BEFORE UPDATE ON lead_source_options
FOR EACH ROW
EXECUTE FUNCTION set_lead_source_options_updated_at();

INSERT INTO lead_source_options (
  source_key,
  customer_label,
  internal_label,
  reporting_category,
  display_order,
  is_active,
  is_public,
  requires_detail,
  detail_label
) VALUES
  ('google_search', 'Google Search / Maps', 'Google Search / Maps', 'google_search', 10, TRUE, TRUE, FALSE, NULL),
  ('google_lsa', 'Google Local Services', 'Google Local Services', 'google_lsa', 20, TRUE, TRUE, FALSE, NULL),
  ('nextdoor', 'Nextdoor', 'Nextdoor', 'nextdoor', 30, TRUE, TRUE, FALSE, NULL),
  ('facebook', 'Facebook', 'Facebook', 'social', 40, TRUE, TRUE, FALSE, NULL),
  ('instagram', 'Instagram', 'Instagram', 'social', 50, TRUE, TRUE, FALSE, NULL),
  ('yelp', 'Yelp', 'Yelp', 'yelp', 60, TRUE, TRUE, FALSE, NULL),
  ('chatgpt', 'ChatGPT', 'ChatGPT', 'ai_assistant', 70, TRUE, TRUE, FALSE, NULL),
  ('gemini', 'Gemini', 'Gemini', 'ai_assistant', 80, TRUE, TRUE, FALSE, NULL),
  ('claude', 'Claude', 'Claude', 'ai_assistant', 90, TRUE, TRUE, FALSE, NULL),
  ('grok', 'Grok', 'Grok', 'ai_assistant', 100, TRUE, TRUE, FALSE, NULL),
  ('perplexity', 'Perplexity', 'Perplexity', 'ai_assistant', 110, TRUE, TRUE, FALSE, NULL),
  ('vehicle_wrap', 'Saw a Sasquatch vehicle', 'Saw a Sasquatch vehicle', 'offline', 120, TRUE, TRUE, FALSE, NULL),
  ('nfc_partner', 'NFC card / partner location', 'NFC card / partner location', 'partner', 130, TRUE, TRUE, TRUE, 'Partner location or card code'),
  ('referral', 'Word of mouth / referral', 'Word of mouth / referral', 'referral', 140, TRUE, TRUE, TRUE, 'Who referred you?'),
  ('realtor_property_manager', 'Realtor / property manager', 'Realtor / property manager', 'referral', 150, TRUE, TRUE, TRUE, 'Name or company'),
  ('repeat_customer', 'Repeat customer', 'Repeat customer', 'repeat_customer', 160, TRUE, TRUE, FALSE, NULL),
  ('other', 'Other', 'Other', 'other', 170, TRUE, TRUE, TRUE, 'Please tell us where you found us')
ON CONFLICT (source_key) DO UPDATE SET
  customer_label = EXCLUDED.customer_label,
  internal_label = EXCLUDED.internal_label,
  reporting_category = EXCLUDED.reporting_category,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active,
  is_public = EXCLUDED.is_public,
  requires_detail = EXCLUDED.requires_detail,
  detail_label = EXCLUDED.detail_label,
  updated_at = NOW();

ALTER TABLE ops_appointments
  ADD COLUMN IF NOT EXISTS lead_source_key TEXT,
  ADD COLUMN IF NOT EXISTS lead_source_detail TEXT,
  ADD COLUMN IF NOT EXISTS original_lead_source TEXT;

ALTER TABLE ops_appointments
  DROP CONSTRAINT IF EXISTS ops_appointments_lead_source_key_fkey;

ALTER TABLE ops_appointments
  ADD CONSTRAINT ops_appointments_lead_source_key_fkey
  FOREIGN KEY (lead_source_key)
  REFERENCES lead_source_options(source_key);

CREATE INDEX IF NOT EXISTS idx_ops_appointments_lead_source_key
ON ops_appointments(lead_source_key);

CREATE OR REPLACE FUNCTION normalize_lead_source_key(value TEXT)
RETURNS TEXT AS $$
DECLARE
  v TEXT := regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', ' ', 'g');
  dense TEXT;
BEGIN
  v := btrim(v);
  dense := regexp_replace(v, '\s+', '', 'g');

  IF dense = ANY (ARRAY[
    'googlelsa',
    'googlelocalservices',
    'googlelocalservice',
    'googlelocalservicesads',
    'localservicesads',
    'lsa'
  ]) OR v LIKE '%google local services%' OR v LIKE '%local services ads%' THEN
    RETURN 'google_lsa';
  ELSIF dense = ANY (ARRAY['google', 'googlesearch', 'googlemaps', 'googlesearchmaps']) THEN
    RETURN 'google_search';
  ELSIF dense = 'nextdoor' THEN
    RETURN 'nextdoor';
  ELSIF dense = 'facebook' THEN
    RETURN 'facebook';
  ELSIF dense = 'instagram' THEN
    RETURN 'instagram';
  ELSIF dense = 'yelp' THEN
    RETURN 'yelp';
  ELSIF dense IN ('chatgpt', 'openai') THEN
    RETURN 'chatgpt';
  ELSIF dense IN ('gemini', 'googleai') THEN
    RETURN 'gemini';
  ELSIF dense IN ('claude', 'anthropic') THEN
    RETURN 'claude';
  ELSIF dense = 'grok' THEN
    RETURN 'grok';
  ELSIF dense = 'perplexity' THEN
    RETURN 'perplexity';
  ELSIF v LIKE '%truck%' OR v LIKE '%vehicle%' OR v LIKE '%wrap%' THEN
    RETURN 'vehicle_wrap';
  ELSIF v LIKE '%nfc%' OR v LIKE '%partner%' OR v LIKE '%milano%' OR v LIKE '%scc20%' OR v LIKE '%nail salon%' THEN
    RETURN 'nfc_partner';
  ELSIF v LIKE '%realtor%' OR v LIKE '%property manager%' OR v LIKE '%real estate%' THEN
    RETURN 'realtor_property_manager';
  ELSIF v LIKE '%word of mouth%' OR v LIKE '%referral%' OR v LIKE '%referred%' THEN
    RETURN 'referral';
  ELSIF v LIKE '%repeat%' OR v LIKE '%returning customer%' THEN
    RETURN 'repeat_customer';
  ELSIF dense = 'other' THEN
    RETURN 'other';
  END IF;

  RETURN 'other';
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;

UPDATE ops_appointments a
SET
  original_lead_source = COALESCE(a.original_lead_source, NULLIF(a.lead_source, '')),
  lead_source_key = normalize_lead_source_key(a.lead_source),
  lead_source_detail = COALESCE(
    a.lead_source_detail,
    CASE
      WHEN normalize_lead_source_key(a.lead_source) = 'nfc_partner'
        AND a.lead_source IS NOT NULL
        AND a.lead_source NOT ILIKE 'NFC card / partner location'
        THEN a.lead_source
      WHEN normalize_lead_source_key(a.lead_source) = 'other'
        AND a.lead_source IS NOT NULL
        AND a.lead_source NOT ILIKE 'Other'
        THEN a.lead_source
      ELSE NULL
    END
  ),
  lead_source = lso.customer_label
FROM lead_source_options lso
WHERE a.lead_source IS NOT NULL
  AND lso.source_key = normalize_lead_source_key(a.lead_source)
  AND (
    a.lead_source_key IS NULL
    OR a.lead_source IS DISTINCT FROM lso.customer_label
    OR a.original_lead_source IS NULL
  );

CREATE OR REPLACE FUNCTION get_lead_source_stats(
  p_start_date DATE DEFAULT '2020-01-01',
  p_end_date DATE DEFAULT '2099-12-31'
)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  WITH appointment_revenue AS (
    SELECT
      a.id,
      a.status,
      COALESCE(a.lead_source_key, normalize_lead_source_key(a.lead_source), 'other') AS source_key,
      COALESCE(i.total, a.quoted_total, 0) AS revenue
    FROM ops_appointments a
    LEFT JOIN ops_invoices i ON i.appointment_id = a.id
    WHERE a.appointment_date >= p_start_date
      AND a.appointment_date <= p_end_date
      AND a.status <> 'cancelled'
      AND (a.lead_source_key IS NOT NULL OR a.lead_source IS NOT NULL)
  ),
  grouped AS (
    SELECT
      ar.source_key,
      COALESCE(lso.customer_label, 'Other') AS lead_source,
      COALESCE(lso.reporting_category, 'other') AS reporting_category,
      COUNT(*)::INTEGER AS booking_count,
      COUNT(*) FILTER (WHERE ar.status = 'completed')::INTEGER AS completed_count,
      ROUND(SUM(ar.revenue)::NUMERIC, 2) AS total_revenue
    FROM appointment_revenue ar
    LEFT JOIN lead_source_options lso ON lso.source_key = ar.source_key
    GROUP BY ar.source_key, lso.customer_label, lso.reporting_category, lso.display_order
    ORDER BY booking_count DESC, MIN(lso.display_order)
  ),
  totals AS (
    SELECT
      COALESCE(SUM(booking_count), 0)::INTEGER AS total_bookings,
      COALESCE(ROUND(SUM(total_revenue)::NUMERIC, 2), 0)::NUMERIC AS total_revenue
    FROM grouped
  )
  SELECT jsonb_build_object(
    'sources',
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'source_key', g.source_key,
          'lead_source', g.lead_source,
          'reporting_category', g.reporting_category,
          'booking_count', g.booking_count,
          'completed_count', g.completed_count,
          'total_revenue', g.total_revenue,
          'avg_ticket',
            CASE
              WHEN g.booking_count > 0 THEN ROUND(g.total_revenue / g.booking_count, 2)
              ELSE 0
            END,
          'percentage',
            CASE
              WHEN t.total_bookings > 0 THEN ROUND((g.booking_count::NUMERIC / t.total_bookings) * 100, 1)
              ELSE 0
            END
        )
        ORDER BY g.booking_count DESC
      ),
      '[]'::JSONB
    ),
    'total_bookings', t.total_bookings,
    'total_revenue', t.total_revenue,
    'date_range', jsonb_build_object('start', p_start_date, 'end', p_end_date)
  )
  INTO result
  FROM totals t
  LEFT JOIN grouped g ON TRUE
  GROUP BY t.total_bookings, t.total_revenue;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;
