-- Reactivation campaign engine for dormant customer email nurture.

CREATE TABLE IF NOT EXISTS reactivation_settings (
  id boolean PRIMARY KEY DEFAULT true,
  engine_enabled boolean NOT NULL DEFAULT true,
  daily_send_cap integer NOT NULL DEFAULT 35 CHECK (daily_send_cap >= 0 AND daily_send_cap <= 500),
  cadence_days integer NOT NULL DEFAULT 30 CHECK (cadence_days >= 7 AND cadence_days <= 120),
  dormancy_months integer NOT NULL DEFAULT 6 CHECK (dormancy_months >= 1 AND dormancy_months <= 36),
  default_offer text NOT NULL DEFAULT '$20 off your next cleaning',
  strong_offer_enabled boolean NOT NULL DEFAULT false,
  strong_offer text NOT NULL DEFAULT '$35 off your next cleaning',
  strong_offer_expires_at date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reactivation_settings_singleton CHECK (id)
);

INSERT INTO reactivation_settings (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS reactivation_email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  category text NOT NULL CHECK (
    category IN (
      'reconnect',
      'service_spotlight',
      'local_trust',
      'offer',
      'strong_offer',
      'quiet_reminder'
    )
  ),
  label text NOT NULL,
  rotation_order integer NOT NULL,
  subject_template text NOT NULL,
  body_template text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  is_strong_offer boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reactivation_templates_enabled_order
  ON reactivation_email_templates (is_enabled, rotation_order);

CREATE TABLE IF NOT EXISTS reactivation_campaign_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES ops_customers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN (
      'active',
      'eligible',
      'paused_recent_booking',
      'post_job_drip',
      'suppressed_manual',
      'suppressed_unsubscribed',
      'suppressed_bounced',
      'excluded_no_email',
      'excluded_duplicate'
    )
  ),
  enrollment_source text NOT NULL DEFAULT 'six_month_dormant_customer',
  current_rotation_index integer NOT NULL DEFAULT 0,
  next_send_at date,
  messages_sent integer NOT NULL DEFAULT 0 CHECK (messages_sent >= 0),
  last_sent_at timestamptz,
  latest_appointment_at date,
  paused_until date,
  stop_reason text,
  manual_suppressed_at timestamptz,
  manual_suppressed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  manual_suppression_reason text,
  manual_resume_at timestamptz,
  override_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id)
);

CREATE INDEX IF NOT EXISTS idx_reactivation_enrollments_status_next_send
  ON reactivation_campaign_enrollments (status, next_send_at);

CREATE INDEX IF NOT EXISTS idx_reactivation_enrollments_customer
  ON reactivation_campaign_enrollments (customer_id);

CREATE TABLE IF NOT EXISTS reactivation_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid REFERENCES reactivation_campaign_enrollments(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES ops_customers(id) ON DELETE SET NULL,
  template_id uuid REFERENCES reactivation_email_templates(id) ON DELETE SET NULL,
  event_type text NOT NULL DEFAULT 'email' CHECK (
    event_type IN (
      'email',
      'enrolled',
      'paused',
      'resumed',
      'suppressed',
      'unsubscribed',
      'skipped'
    )
  ),
  template_key text,
  subject text,
  body_text text,
  to_email text,
  resend_id text,
  status text NOT NULL DEFAULT 'sent' CHECK (
    status IN ('sent', 'failed', 'skipped', 'logged')
  ),
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reactivation_log_customer_sent_at
  ON reactivation_email_log (customer_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_reactivation_log_status_sent_at
  ON reactivation_email_log (status, sent_at DESC);

ALTER TABLE reactivation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reactivation_email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE reactivation_campaign_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reactivation_email_log ENABLE ROW LEVEL SECURITY;

INSERT INTO reactivation_email_templates (
  template_key,
  category,
  label,
  rotation_order,
  subject_template,
  body_template,
  is_enabled,
  is_strong_offer
) VALUES
(
  'reconnect_system_upgrade',
  'reconnect',
  'Reconnect - Scheduling Upgrade',
  0,
  'Still here when the carpets get weird',
  E'Hey {{first_name}},\n\nIt''s Charles from Sasquatch Carpet Cleaning.\n\nIt''s been a little while since we''ve had the chance to help, so I just wanted to say hi and let you know we''re still out here cleaning carpets, upholstery, rugs, tile, and the occasional mystery spot nobody wants to claim.\n\nWe''ve also upgraded our scheduling system, so booking is a lot easier now. Less back-and-forth, fewer missed messages, and fewer “I thought I replied to that” moments, which I personally respect because I am also a human being with a phone.\n\nIf your carpets are due for a refresh, you can grab a spot here:\n\n{{booking_url}}\n\nOr just reply to this email and we''ll help get you set up.\n\nStay legendary,\nCharles\nSasquatch Carpet Cleaning',
  true,
  false
),
(
  'service_spotlight_upholstery',
  'service_spotlight',
  'Service Spotlight - Upholstery',
  10,
  'We clean couches too, which surprises people',
  E'Hey {{first_name}},\n\nQuick Sasquatch reminder: we do more than carpet.\n\nUpholstery is one of those things people forget about until the couch starts looking like it has been through several administrations. We can clean sofas, sectionals, chairs, and the spots where everybody sits even though the rest of the couch is technically available.\n\nIf your carpets are fine but the furniture could use help, we can take care of that too.\n\nPast customer offer: {{default_offer}}.\n\nBook here if you want us to take a look:\n\n{{booking_url}}\n\nThanks,\nCharles\nSasquatch Carpet Cleaning',
  true,
  false
),
(
  'local_trust_owner_led',
  'local_trust',
  'Local Trust - Owner Led',
  20,
  'Still local. Still cleaning carpets.',
  E'Hey {{first_name}},\n\nIt''s Charles with Sasquatch.\n\nWe''re still a local carpet cleaning company serving Colorado Springs, Monument, Palmer Lake, Woodmoor, and the Tri-Lakes area. Same Sasquatch, just with better systems now and fewer sticky notes trying to run the whole operation.\n\nI know there are a lot of companies you can call. We appreciate every person who chooses a small local business and trusts us inside their home.\n\nIf you need carpet, upholstery, rugs, tile, or pet odor help, we''d be happy to earn the next visit too.\n\n{{booking_url}}\n\nStay legendary,\nCharles\nSasquatch Carpet Cleaning',
  true,
  false
),
(
  'standing_offer_twenty',
  'offer',
  'Standing Offer - $20 Off',
  30,
  '$20 off your next Sasquatch refresh',
  E'Hey {{first_name}},\n\nJust a simple past-customer thank you today.\n\nIf your floors, furniture, rugs, or tile could use a refresh, we''ll take {{default_offer}}. Nothing complicated. No secret code where you have to whisper “Sasquatch” into the phone. Although honestly, that would be memorable.\n\nYou can book online here:\n\n{{booking_url}}\n\nOr reply to this email and we''ll help you find a time.\n\nThanks again for working with us before.\n\nCharles\nSasquatch Carpet Cleaning',
  true,
  false
),
(
  'quiet_reminder_here_when_needed',
  'quiet_reminder',
  'Quiet Reminder - Here When Needed',
  40,
  'Here when you need us',
  E'Hey {{first_name}},\n\nNo big sales pitch today.\n\nJust a quick note that Sasquatch is here when the carpets, furniture, rugs, tile, or mystery spots need backup.\n\nIf everything looks good, honestly, that is great. We love that for you. If not, we can help.\n\nBook here whenever it makes sense:\n\n{{booking_url}}\n\nThanks,\nCharles\nSasquatch Carpet Cleaning',
  true,
  false
),
(
  'strong_offer_schedule_fill',
  'strong_offer',
  'Schedule Fill Offer',
  50,
  'A little extra room on the schedule',
  E'Hey {{first_name}},\n\nWe have a little extra room on the schedule, so I''m making the offer a little better than usual.\n\nFor a limited time, we can do {{strong_offer}} for past customers. Carpets, upholstery, rugs, tile, pet odor work — if it is something we clean, this can help take the edge off the total.\n\nI''m working on keeping the schedule full while we train up another technician, which is a very official way of saying I would rather have the calendar busy than sit around pretending I enjoy paperwork.\n\nYou can grab a spot here:\n\n{{booking_url}}\n\nThanks,\nCharles\nSasquatch Carpet Cleaning',
  true,
  true
)
ON CONFLICT (template_key) DO NOTHING;
