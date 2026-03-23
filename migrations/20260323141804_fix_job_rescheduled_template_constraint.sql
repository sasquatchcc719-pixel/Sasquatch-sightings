-- Fix: Update CHECK constraint to include job_rescheduled_sms template
-- This allows the job_rescheduled_sms template to be properly inserted

ALTER TABLE ops_communication_templates
DROP CONSTRAINT IF EXISTS ops_communication_templates_template_key_check;

ALTER TABLE ops_communication_templates
ADD CONSTRAINT ops_communication_templates_template_key_check
CHECK (
  template_key IN (
    'job_scheduled_sms',
    'on_my_way_sms',
    'job_finished_sms',
    'job_rescheduled_sms',
    'job_scheduled_email',
    'job_finished_email',
    'satisfaction_checkin_email'
  )
);

-- Now insert the job_rescheduled_sms template
INSERT INTO ops_communication_templates (
  template_key,
  channel,
  label,
  is_enabled,
  subject_template,
  body_template,
  delay_hours
)
VALUES (
  'job_rescheduled_sms',
  'sms',
  'Job Rescheduled (SMS)',
  true,
  null,
  'Hi {{first_name}}, your Sasquatch Carpet Cleaning appointment has been rescheduled to {{appointment_date}} at {{start_time}}. Same address: {{address_line}}. Questions? Reply or call us anytime.',
  0
)
ON CONFLICT (template_key) DO UPDATE SET
  label = EXCLUDED.label,
  body_template = EXCLUDED.body_template,
  is_enabled = EXCLUDED.is_enabled,
  delay_hours = EXCLUDED.delay_hours;
