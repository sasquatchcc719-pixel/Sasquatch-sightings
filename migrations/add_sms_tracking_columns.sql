-- SMS Lead Nurturing Database Migration
-- Adds tracking columns to leads table for SMS follow-ups

-- Add SMS tracking columns
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS day_3_sms_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS day_7_sms_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS day_14_sms_sent_at TIMESTAMPTZ;

-- Add indexes for efficient cron job queries
CREATE INDEX IF NOT EXISTS idx_leads_day_3_sms ON leads (day_3_sms_sent_at) WHERE day_3_sms_sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_day_7_sms ON leads (day_7_sms_sent_at) WHERE day_7_sms_sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_day_14_sms ON leads (day_14_sms_sent_at) WHERE day_14_sms_sent_at IS NULL;

-- Add comment explaining the columns
COMMENT ON COLUMN leads.day_3_sms_sent_at IS 'Timestamp when day 3 nurture SMS was sent';
COMMENT ON COLUMN leads.day_7_sms_sent_at IS 'Timestamp when day 7 nurture SMS was sent';
COMMENT ON COLUMN leads.day_14_sms_sent_at IS 'Timestamp when day 14 nurture SMS was sent';
