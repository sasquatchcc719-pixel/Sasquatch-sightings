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
) VALUES (
  'door_hanger',
  'Door hanger',
  'Door hanger',
  'offline',
  125,
  TRUE,
  TRUE,
  FALSE,
  NULL
)
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
  ELSIF v LIKE '%door hanger%' OR dense = 'doorhanger' OR v LIKE '%door tag%' OR v LIKE '%door flyer%' THEN
    RETURN 'door_hanger';
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
