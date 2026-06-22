CREATE INDEX IF NOT EXISTS idx_nfc_card_taps_personal_tapped_at
  ON public.nfc_card_taps (tapped_at DESC)
  WHERE partner_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_nfc_button_clicks_tap_id_button_type
  ON public.nfc_button_clicks (tap_id, button_type);

CREATE OR REPLACE FUNCTION public.get_business_card_tap_analytics(
  p_start_at timestamptz DEFAULT '1970-01-01'::timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered_taps AS (
    SELECT
      id,
      card_id,
      ip_address,
      device_type,
      location_city,
      converted,
      tapped_at
    FROM public.nfc_card_taps
    WHERE partner_id IS NULL
      AND tapped_at >= p_start_at
  ),
  click_counts AS (
    SELECT
      c.button_type,
      count(*)::int AS total
    FROM public.nfc_button_clicks c
    JOIN filtered_taps t ON t.id = c.tap_id
    GROUP BY c.button_type
  ),
  city_counts AS (
    SELECT
      location_city AS city,
      count(*)::int AS total
    FROM filtered_taps
    WHERE location_city IS NOT NULL
    GROUP BY location_city
    ORDER BY total DESC
    LIMIT 5
  ),
  tap_summary AS (
    SELECT
      count(*)::int AS total_taps,
      count(DISTINCT ip_address)::int AS unique_taps,
      count(*) FILTER (WHERE converted)::int AS conversions,
      count(*) FILTER (WHERE tapped_at >= date_trunc('day', now()))::int AS today_taps,
      count(*) FILTER (WHERE tapped_at >= now() - interval '7 days')::int AS week_taps,
      count(*) FILTER (WHERE tapped_at >= now() - interval '30 days')::int AS month_taps,
      count(*) FILTER (WHERE device_type = 'mobile')::int AS mobile_taps,
      count(*) FILTER (WHERE device_type = 'tablet')::int AS tablet_taps,
      count(*) FILTER (WHERE device_type = 'desktop')::int AS desktop_taps,
      count(*) FILTER (WHERE card_id IS DISTINCT FROM 'truck-qr-contest')::int AS card_scans,
      count(*) FILTER (WHERE card_id = 'truck-qr-contest')::int AS contest_scans
    FROM filtered_taps
  )
  SELECT jsonb_build_object(
    'totalTaps', s.total_taps,
    'uniqueTaps', s.unique_taps,
    'conversions', s.conversions,
    'conversionRate',
      CASE
        WHEN s.total_taps > 0 THEN (s.conversions::numeric / s.total_taps::numeric) * 100
        ELSE 0
      END,
    'bookingClicks', COALESCE((SELECT total FROM click_counts WHERE button_type = 'booking_page'), 0),
    'callClicks', COALESCE((SELECT total FROM click_counts WHERE button_type = 'call'), 0),
    'textClicks', COALESCE((SELECT total FROM click_counts WHERE button_type = 'text'), 0),
    'formSubmits', COALESCE((SELECT total FROM click_counts WHERE button_type = 'form_submit'), 0),
    'saveContactClicks', COALESCE((SELECT total FROM click_counts WHERE button_type = 'save_contact'), 0),
    'shareClicks', COALESCE((SELECT total FROM click_counts WHERE button_type = 'share'), 0),
    'todayTaps', s.today_taps,
    'weekTaps', s.week_taps,
    'monthTaps', s.month_taps,
    'topCities',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object('city', city, 'count', total)
            ORDER BY total DESC
          )
          FROM city_counts
        ),
        '[]'::jsonb
      ),
    'deviceBreakdown',
      jsonb_build_object(
        'mobile', s.mobile_taps,
        'tablet', s.tablet_taps,
        'desktop', s.desktop_taps
      ),
    'cardScans', s.card_scans,
    'contestScans', s.contest_scans
  )
  FROM tap_summary s;
$$;

REVOKE EXECUTE ON FUNCTION public.get_business_card_tap_analytics(timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_business_card_tap_analytics(timestamptz)
  TO service_role;
