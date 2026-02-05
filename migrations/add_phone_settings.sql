-- Phone settings table for admin control of voicemail and call routing
CREATE TABLE IF NOT EXISTS phone_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Voicemail settings
  voicemail_message TEXT NOT NULL DEFAULT 'Thanks for calling Sasquatch Carpet Cleaning. You''ve either reached us after business hours or we''re currently assisting other customers. You can book immediately at sasquatch carpet dot com and add any questions to the notes. Or leave a message after the beep and we''ll get back to you as soon as possible.',
  voicemail_voice TEXT NOT NULL DEFAULT 'Polly.Joanna-Neural',
  
  -- Business hours (stored as integers, 0-23)
  business_hours_start INTEGER NOT NULL DEFAULT 9,
  business_hours_end INTEGER NOT NULL DEFAULT 17,
  business_days TEXT[] NOT NULL DEFAULT ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  
  -- SIP endpoints (array of usernames)
  sip_endpoints TEXT[] NOT NULL DEFAULT ARRAY['chuck'],
  sip_domain TEXT NOT NULL DEFAULT 'sasquatch-cc.sip.twilio.com',
  dial_timeout INTEGER NOT NULL DEFAULT 20,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings if table is empty
INSERT INTO phone_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM phone_settings);

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_phone_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phone_settings_updated_at
  BEFORE UPDATE ON phone_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_phone_settings_updated_at();
