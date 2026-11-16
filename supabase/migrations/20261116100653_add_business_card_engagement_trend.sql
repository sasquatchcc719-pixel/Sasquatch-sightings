/Users/chuckdeezil/.bash_profile: line 8: /var/folders/p0/crszzg5d71j70_5dfsfsmjr40000gn/T/cursor-sandbox-cache/847d96d8842e170398586d1cccae47ca/cargo/env: No such file or directory
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
      conversion_type,
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
      count(*) FILTER (
        WHERE converted OR conversion_type IN ('booking', 'form')
      )::int AS conversions,
      count(*) FILTER (
        WHERE tapped_at >=
          (date_trunc('day', now() AT TIME ZONE 'America/Denver')
            AT TIME ZONE 'America/Denver')
      )::int AS today_taps,
      count(*) FILTER (WHERE tapped_at >= now() - interval '7 days')::int AS week_taps,
      count(*) FILTER (WHERE tapped_at >= now() - interval '30 days')::int AS month_taps,
      count(*) FILTER (WHERE device_type = 'mobile')::int AS mobile_taps,
      count(*) FILTER (WHERE device_type = 'tablet')::int AS tablet_taps,
      count(*) FILTER (WHERE device_type = 'desktop')::int AS desktop_taps,
      count(*) FILTER (WHERE card_id IS DISTINCT FROM 'truck-qr-contest')::int AS card_scans,
      count(*) FILTER (WHERE card_id = 'truck-qr-contest')::int AS contest_scans
    FROM filtered_taps
  ),
  trend_settings AS (
    SELECT
      CASE
        WHEN p_start_at < now() - interval '90 days' THEN 'month'
        ELSE 'day'
      END AS granularity,
      greatest(
        p_start_at,
        COALESCE(
          (
            SELECT min(tapped_at)
            FROM public.nfc_card_taps
            WHERE partner_id IS NULL
          ),
          now()
        )
      ) AS first_event_at
  ),
  trend_bounds AS (
    SELECT
      granularity,
      date_trunc(
        granularity,
        first_event_at AT TIME ZONE 'America/Denver'
      ) AS first_bucket,
      date_trunc(
        granularity,
        now() AT TIME ZONE 'America/Denver'
      ) AS last_bucket
    FROM trend_settings
  ),
  trend_buckets AS (
    SELECT
      b.granularity,
      generate_series(
        b.first_bucket,
        b.last_bucket,
        CASE
          WHEN b.granularity = 'month' THEN interval '1 month'
          ELSE interval '1 day'
        END
      ) AS bucket
    FROM trend_bounds b
  ),
  tap_trend AS (
    SELECT
      date_trunc(
        b.granularity,
        t.tapped_at AT TIME ZONE 'America/Denver'
      ) AS bucket,
      count(*)::int AS total
    FROM filtered_taps t
    CROSS JOIN trend_bounds b
    GROUP BY 1
  ),
  action_trend AS (
    SELECT
      date_trunc(
        b.granularity,
        c.clicked_at AT TIME ZONE 'America/Denver'
      ) AS bucket,
      count(*)::int AS total
    FROM public.nfc_button_clicks c
    JOIN public.nfc_card_taps t ON t.id = c.tap_id
    CROSS JOIN trend_bounds b
    WHERE t.partner_id IS NULL
      AND c.clicked_at >= p_start_at
    GROUP BY 1
  ),
  engagement_trend AS (
    SELECT
      buckets.bucket,
      buckets.granularity,
      COALESCE(taps.total, 0) AS taps,
      COALESCE(actions.total, 0) AS actions
    FROM trend_buckets buckets
    LEFT JOIN tap_trend taps ON taps.bucket = buckets.bucket
    LEFT JOIN action_trend actions ON actions.bucket = buckets.bucket
    ORDER BY buckets.bucket
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
    'bookingClicks', COALESCE((
      SELECT sum(total)
      FROM click_counts
      WHERE button_type IN (
        'booking_widget_open',
        'booking_widget_submit',
        'booking_page',
        'book_now'
      )
    ), 0),
    'callClicks', COALESCE((SELECT total FROM click_counts WHERE button_type = 'call'), 0),
    'textClicks', COALESCE((
      SELECT sum(total)
      FROM click_counts
      WHERE button_type IN ('text', 'text_us', 'text_chat')
    ), 0),
    'formSubmits', COALESCE((SELECT total FROM click_counts WHERE button_type = 'form_submit'), 0),
    'saveContactClicks', COALESCE((SELECT total FROM click_counts WHERE button_type = 'save_contact'), 0),
    'shareClicks', COALESCE((SELECT total FROM click_counts WHERE button_type = 'share'), 0),
    'contractorClicks', COALESCE((SELECT total FROM click_counts WHERE button_type = 'recommended_contractors'), 0),
    'todayTaps', s.today_taps,
    'weekTaps', s.week_taps,
    'monthTaps', s.month_taps,
    'engagementTrend',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'period', to_char(bucket, 'YYYY-MM-DD'),
              'taps', taps,
              'actions', actions
            )
            ORDER BY bucket
          )
          FROM engagement_trend
        ),
        '[]'::jsonb
      ),
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

