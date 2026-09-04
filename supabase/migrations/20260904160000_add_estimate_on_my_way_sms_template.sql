-- "On my way" text for estimate (measuring) visits. The regular on_my_way_sms
-- links the carpet-cleaning "what to expect" video, which is wrong for a
-- walkthrough where nothing gets cleaned yet.
ALTER TABLE ops_communication_templates DROP CONSTRAINT IF EXISTS ops_communication_templates_template_key_check;
ALTER TABLE ops_communication_templates ADD CONSTRAINT ops_communication_templates_template_key_check
  CHECK (template_key = ANY (ARRAY[
    'job_scheduled_sms',
    'on_my_way_sms',
    'on_my_way_estimate_sms',
    'job_finished_sms',
    'job_rescheduled_sms',
    'day_before_residential_sms',
    'day_before_recovery_village_sms',
    'day_before_restoration_sms',
    'day_before_restoration_monitor_sms',
    'on_my_way_restoration_sms',
    'job_finished_restoration_sms',
    'job_finished_restoration_monitor_sms',
    'job_rescheduled_restoration_sms',
    'job_scheduled_email',
    'job_rescheduled_email',
    'job_finished_email',
    'job_finished_email_urine',
    'satisfaction_checkin_email'
  ]));

INSERT INTO ops_communication_templates (template_key, channel, label, is_enabled, subject_template, body_template, delay_hours)
SELECT
  'on_my_way_estimate_sms',
  'sms',
  'On my way text (estimate visit)',
  true,
  NULL,
  '{{tech_name}} from Sasquatch Carpet Cleaning is on the way to take a look and put together your estimate, and should arrive shortly! If anything changed with access, just reply here.',
  0
WHERE NOT EXISTS (
  SELECT 1 FROM ops_communication_templates WHERE template_key = 'on_my_way_estimate_sms'
);
