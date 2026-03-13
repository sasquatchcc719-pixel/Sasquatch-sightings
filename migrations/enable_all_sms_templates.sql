-- Enable all SMS templates for testing.
-- Run this in Supabase SQL editor to turn on all text notifications.
UPDATE ops_communication_templates
SET is_enabled = true
WHERE channel = 'sms';
