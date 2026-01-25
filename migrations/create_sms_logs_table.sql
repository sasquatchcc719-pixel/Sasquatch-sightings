-- SMS Logs Table
-- Tracks all SMS messages sent to leads, partners, and admin

CREATE TABLE IF NOT EXISTS sms_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,
  message_type TEXT NOT NULL, -- 'contest_entry', 'day_3_nurture', 'day_7_nurture', 'day_14_nurture', 'partner_referral', 'partner_credit', 'admin_alert'
  message_content TEXT NOT NULL,
  status TEXT DEFAULT 'sent', -- 'sent', 'failed', 'delivered'
  twilio_sid TEXT, -- Twilio message SID for tracking
  sent_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_sms_logs_lead_id ON sms_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_partner_id ON sms_logs(partner_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_recipient_phone ON sms_logs(recipient_phone);
CREATE INDEX IF NOT EXISTS idx_sms_logs_message_type ON sms_logs(message_type);
CREATE INDEX IF NOT EXISTS idx_sms_logs_sent_at ON sms_logs(sent_at DESC);

-- RLS Policies
ALTER TABLE sms_logs ENABLE ROW LEVEL SECURITY;

-- Admin can see all logs
CREATE POLICY "Admin can view all SMS logs"
  ON sms_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM partners
      WHERE partners.user_id = auth.uid()
      AND partners.role = 'admin'
    )
  );

-- Partners can only see their own SMS logs
CREATE POLICY "Partners can view their own SMS logs"
  ON sms_logs FOR SELECT
  TO authenticated
  USING (
    partner_id IN (
      SELECT id FROM partners
      WHERE user_id = auth.uid()
    )
  );

-- Comments
COMMENT ON TABLE sms_logs IS 'Tracks all SMS messages sent through Twilio';
COMMENT ON COLUMN sms_logs.message_type IS 'Type of SMS: contest_entry, day_3_nurture, day_7_nurture, day_14_nurture, partner_referral, partner_credit, admin_alert';
COMMENT ON COLUMN sms_logs.twilio_sid IS 'Twilio message SID for delivery tracking';
