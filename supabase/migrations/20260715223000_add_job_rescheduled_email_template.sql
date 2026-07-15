ALTER TABLE ops_communication_templates
DROP CONSTRAINT IF EXISTS ops_communication_templates_template_key_check;

ALTER TABLE ops_communication_templates
ADD CONSTRAINT ops_communication_templates_template_key_check
CHECK (
  template_key = ANY (ARRAY[
    'job_scheduled_sms'::text,
    'on_my_way_sms'::text,
    'job_finished_sms'::text,
    'job_rescheduled_sms'::text,
    'day_before_residential_sms'::text,
    'day_before_recovery_village_sms'::text,
    'job_scheduled_email'::text,
    'job_rescheduled_email'::text,
    'job_finished_email'::text,
    'satisfaction_checkin_email'::text
  ])
);

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
  'job_rescheduled_email',
  'email',
  'Reschedule confirmation email',
  true,
  'Your {{company_name}} appointment has been rescheduled for {{appointment_date}}',
  'Hi {{first_name}},

Your appointment with {{company_name}} has been rescheduled for {{appointment_date}} between {{start_time}} and {{end_time}}.

Services:
{{service_summary}}

Service address:
{{address_line}}

To make any changes, please text us at (719) 249-8791.',
  0
)
ON CONFLICT (template_key) DO UPDATE
SET
  channel = EXCLUDED.channel,
  label = EXCLUDED.label,
  is_enabled = EXCLUDED.is_enabled,
  subject_template = EXCLUDED.subject_template,
  body_template = EXCLUDED.body_template,
  delay_hours = EXCLUDED.delay_hours;
