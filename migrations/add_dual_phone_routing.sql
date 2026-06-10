ALTER TABLE phone_settings
ADD COLUMN IF NOT EXISTS twilio_secondary_forward_number text NOT NULL DEFAULT '';

UPDATE phone_settings
SET twilio_secondary_forward_number = '+17197498807'
WHERE twilio_secondary_forward_number = '';
