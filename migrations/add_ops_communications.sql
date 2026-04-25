-- ============================================
-- OPERATIONS COMMUNICATIONS (SMS + EMAIL)
-- ============================================

CREATE TABLE IF NOT EXISTS ops_communication_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  template_key TEXT NOT NULL UNIQUE CHECK (
    template_key IN (
      'job_scheduled_sms',
      'on_my_way_sms',
      'job_finished_sms',
      'job_scheduled_email',
      'job_finished_email',
      'satisfaction_checkin_email'
    )
  ),
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  label TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  subject_template TEXT,
  body_template TEXT NOT NULL,
  delay_hours INTEGER NOT NULL DEFAULT 0 CHECK (delay_hours >= 0),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_communication_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  template_key TEXT NOT NULL REFERENCES ops_communication_templates(template_key) ON DELETE CASCADE,
  appointment_id UUID REFERENCES ops_appointments(id) ON DELETE CASCADE NOT NULL,
  customer_id UUID REFERENCES ops_customers(id) ON DELETE CASCADE NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'sent', 'failed', 'cancelled')
  ),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_communication_queue_due
  ON ops_communication_queue(status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_ops_communication_templates_channel
  ON ops_communication_templates(channel, is_enabled);

ALTER TABLE ops_communication_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_communication_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ops users can read communication templates"
  ON ops_communication_templates FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'tech', 'marketing']));

CREATE POLICY "Owner and dispatcher can manage communication templates"
  ON ops_communication_templates FOR ALL
  USING (app_has_role(ARRAY['owner', 'dispatcher']))
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "Ops users can read communication queue"
  ON ops_communication_queue FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'marketing']));

CREATE POLICY "Owner and dispatcher can manage communication queue"
  ON ops_communication_queue FOR ALL
  USING (app_has_role(ARRAY['owner', 'dispatcher']))
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher']));

INSERT INTO ops_communication_templates (
  template_key,
  channel,
  label,
  is_enabled,
  subject_template,
  body_template,
  delay_hours
)
VALUES
  (
    'job_scheduled_sms',
    'sms',
    'Job scheduled text',
    false,
    null,
    'Hi {{first_name}}, this is {{company_name}}. You are scheduled for {{appointment_date}} between {{start_time}} and {{end_time}} for {{service_summary}} at {{address_line}}.',
    0
  ),
  (
    'on_my_way_sms',
    'sms',
    'On my way text',
    false,
    null,
    '{{tech_name}} from {{company_name}} is on the way and should arrive shortly. If anything changed with access, just reply to this text.',
    0
  ),
  (
    'job_finished_sms',
    'sms',
    'Job finished text',
    false,
    null,
    'Thanks {{first_name}}. We appreciate your support and hope you love the clean. If anything needs attention, reply here and we will take care of it.',
    0
  ),
  (
    'job_scheduled_email',
    'email',
    'Booking confirmation email',
    false,
    'Your {{company_name}} appointment is booked for {{appointment_date}}',
    'Hi {{first_name}},\n\nYour appointment with {{company_name}} is booked for {{appointment_date}} between {{start_time}} and {{end_time}}.\n\nService:\n{{service_summary}}\n\nService address:\n{{address_line}}\n\nIf anything changes, just reply to this email.',
    0
  ),
  (
    'job_finished_email',
    'email',
    'Finished job email',
    false,
    'Thank you from {{company_name}} — care tips & review',
    'Hi {{first_name}},\n\nThank you for choosing {{company_name}}! It was a pleasure serving you today and providing a Legendary Clean for your home.\n\nPost-Cleaning Care & Dry Times:\n\n- Dry Time: While every home is different, carpets generally take 12 to 24 hours to dry completely. We recommend waiting the full 24 hours before moving heavy furniture back or walking on it with outdoor shoes.\n\n- Airflow is Key: To speed things up, move air across the carpet fibers at floor level using ceiling fans or floor fans. Good airflow can sometimes drop dry times to just a few hours!\n\n- Safety First: Please be extra careful when walking from the damp carpet onto hard surfaces like tile or wood—it will be very slippery!\n\nA Small Favor? As a local business, your feedback helps the Sasquatch grow! If you are thrilled with your clean, would you mind leaving us a quick review?\n\nLeave a review here:\nhttps://www.sasquatchcarpet.com/reviews\n\nIf anything is not 100% legendary, text Harry at (719) 358-6137 and we will make it right.\n\nThanks again for the business!\n— {{company_name}}',
    0
  ),
  (
    'satisfaction_checkin_email',
    'email',
    'Satisfaction check-in email',
    false,
    'Quick check-in from {{company_name}}',
    'Hi {{first_name}},\n\nQuick check-in from {{company_name}} to make sure everything is still looking great after your recent service.\n\nIf anything needs attention, just reply and we will take care of it.\n\nIf you have not left a review yet, you can do that here:\nhttps://www.sasquatchcarpet.com/reviews',
    336
  )
ON CONFLICT (template_key) DO NOTHING;
