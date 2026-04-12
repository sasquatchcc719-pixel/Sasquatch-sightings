-- Expand the template_key check constraint to include job_rescheduled_sms
ALTER TABLE ops_communication_templates DROP CONSTRAINT ops_communication_templates_template_key_check;
ALTER TABLE ops_communication_templates ADD CONSTRAINT ops_communication_templates_template_key_check
  CHECK (template_key = ANY (ARRAY[
    'job_scheduled_sms'::text,
    'on_my_way_sms'::text,
    'job_finished_sms'::text,
    'job_rescheduled_sms'::text,
    'job_scheduled_email'::text,
    'job_finished_email'::text,
    'satisfaction_checkin_email'::text
  ]));

-- Insert the rescheduled SMS template
INSERT INTO ops_communication_templates (template_key, channel, label, is_enabled, subject_template, body_template, delay_hours)
VALUES (
  'job_rescheduled_sms',
  'sms',
  'Job Rescheduled SMS',
  true,
  null,
  'Hi {{first_name}} — your Sasquatch Carpet Cleaning appointment has been rescheduled to {{appointment_date}} at {{start_time}} at {{address_line}}. Questions? Just reply here.',
  0
)
ON CONFLICT (template_key) DO UPDATE SET
  is_enabled = true,
  body_template = EXCLUDED.body_template;
