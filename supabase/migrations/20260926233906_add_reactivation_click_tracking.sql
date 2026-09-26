-- Reactivation emails had no way to tell whether they worked: the BOOK ONLINE
-- button pointed straight at the website. Each send now carries its own
-- click token, the button goes through /api/public/reactivation-click/<token>,
-- and a booking by a customer who clicked in the last 30 days is stamped
-- with that click so the Reactivation Center can report real results.

ALTER TABLE reactivation_email_log
  ADD COLUMN IF NOT EXISTS click_token text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reactivation_log_click_token
  ON reactivation_email_log (click_token)
  WHERE click_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS reactivation_email_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id uuid REFERENCES reactivation_email_log(id) ON DELETE SET NULL,
  enrollment_id uuid REFERENCES reactivation_campaign_enrollments(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES ops_customers(id) ON DELETE CASCADE,
  template_key text,
  -- Mail security scanners (Outlook Safe Links etc.) open links before the
  -- customer does. Keep those rows for debugging but never count them.
  is_bot boolean NOT NULL DEFAULT false,
  user_agent text,
  clicked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reactivation_clicks_customer_clicked_at
  ON reactivation_email_clicks (customer_id, clicked_at DESC)
  WHERE NOT is_bot;

CREATE INDEX IF NOT EXISTS idx_reactivation_clicks_log
  ON reactivation_email_clicks (log_id);

ALTER TABLE reactivation_email_clicks ENABLE ROW LEVEL SECURITY;

ALTER TABLE ops_appointments
  ADD COLUMN IF NOT EXISTS reactivation_click_id uuid
    REFERENCES reactivation_email_clicks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ops_appointments_reactivation_click
  ON ops_appointments (reactivation_click_id)
  WHERE reactivation_click_id IS NOT NULL;

-- Attribution lives in the database so every booking path (online, phone,
-- admin, AI agents) gets it without each one remembering to. SECURITY
-- DEFINER because the clicks table has RLS and no policies: an insert made
-- through an RLS-bound client would otherwise silently see no clicks.
CREATE OR REPLACE FUNCTION attribute_reactivation_click()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reactivation_click_id IS NULL
     AND NEW.recurring_template_id IS NULL
     AND NEW.customer_id IS NOT NULL THEN
    SELECT c.id INTO NEW.reactivation_click_id
    FROM reactivation_email_clicks c
    WHERE c.customer_id = NEW.customer_id
      AND NOT c.is_bot
      AND c.clicked_at <= COALESCE(NEW.created_at, now())
      AND c.clicked_at > COALESCE(NEW.created_at, now()) - interval '30 days'
    ORDER BY c.clicked_at DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attribute_reactivation_click_trigger ON ops_appointments;
CREATE TRIGGER attribute_reactivation_click_trigger
  BEFORE INSERT ON ops_appointments
  FOR EACH ROW EXECUTE FUNCTION attribute_reactivation_click();

-- Per-template scorecard for the Reactivation Center.
--  clicked_*: bookings stamped by the trigger above (customer clicked, then booked).
--  booked_30d_*: any non-recurring booking within 30 days of an email,
--    credited to the most recent email before it. Looser — some of these
--    customers would have come back anyway — but it covers people who read
--    the email and called instead of clicking.
CREATE OR REPLACE VIEW reactivation_template_results
WITH (security_invoker = true) AS
WITH sends AS (
  SELECT id, customer_id, template_key, sent_at, click_token
  FROM reactivation_email_log
  WHERE event_type = 'email' AND status = 'sent'
),
human_clicks AS (
  SELECT c.id, c.customer_id, COALESCE(c.template_key, l.template_key) AS template_key
  FROM reactivation_email_clicks c
  LEFT JOIN reactivation_email_log l ON l.id = c.log_id
  WHERE NOT c.is_bot
),
live_appts AS (
  SELECT id, customer_id, created_at, quoted_total, reactivation_click_id
  FROM ops_appointments
  WHERE status <> 'cancelled' AND recurring_template_id IS NULL
),
click_bookings AS (
  SELECT hc.template_key, a.id, a.quoted_total
  FROM live_appts a
  JOIN human_clicks hc ON hc.id = a.reactivation_click_id
),
window_bookings AS (
  SELECT DISTINCT ON (a.id) s.template_key, a.id, a.quoted_total
  FROM live_appts a
  JOIN sends s
    ON s.customer_id = a.customer_id
   AND s.sent_at < a.created_at
   AND s.sent_at >= a.created_at - interval '30 days'
  ORDER BY a.id, s.sent_at DESC
),
keys AS (
  SELECT template_key FROM sends
  UNION SELECT template_key FROM human_clicks
)
SELECT
  k.template_key,
  (SELECT count(*) FROM sends s WHERE s.template_key IS NOT DISTINCT FROM k.template_key) AS sent,
  -- Only sends that carried a click link; the click-rate denominator.
  (SELECT count(*) FROM sends s WHERE s.click_token IS NOT NULL AND s.template_key IS NOT DISTINCT FROM k.template_key) AS tracked_sent,
  (SELECT min(sent_at) FROM sends s WHERE s.template_key IS NOT DISTINCT FROM k.template_key) AS first_sent_at,
  (SELECT count(DISTINCT customer_id) FROM human_clicks hc WHERE hc.template_key IS NOT DISTINCT FROM k.template_key) AS customers_clicked,
  (SELECT count(*) FROM click_bookings b WHERE b.template_key IS NOT DISTINCT FROM k.template_key) AS clicked_bookings,
  (SELECT COALESCE(sum(quoted_total), 0) FROM click_bookings b WHERE b.template_key IS NOT DISTINCT FROM k.template_key) AS clicked_booking_value,
  (SELECT count(*) FROM window_bookings b WHERE b.template_key IS NOT DISTINCT FROM k.template_key) AS booked_30d,
  (SELECT COALESCE(sum(quoted_total), 0) FROM window_bookings b WHERE b.template_key IS NOT DISTINCT FROM k.template_key) AS booked_30d_value
FROM keys k;
