CREATE TABLE IF NOT EXISTS harry_command_sms_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_label TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  message TEXT NOT NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  error_message TEXT,
  CONSTRAINT harry_command_sms_drafts_status_check
    CHECK (status IN ('pending', 'sent', 'cancelled', 'failed', 'expired'))
);

CREATE INDEX IF NOT EXISTS harry_command_sms_drafts_status_expires_idx
  ON harry_command_sms_drafts (status, expires_at);

CREATE INDEX IF NOT EXISTS harry_command_sms_drafts_conversation_idx
  ON harry_command_sms_drafts (conversation_id);

ALTER TABLE harry_command_sms_drafts ENABLE ROW LEVEL SECURITY;
