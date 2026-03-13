-- Add job_rescheduled_sms communication template
-- Sent when a job is manually rescheduled via drag-and-drop on the calendar.

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
