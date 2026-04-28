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
VALUES
  (
    'day_before_residential_sms',
    'sms',
    'Day-Before Reminder (Residential)',
    false,
    null,
    'Hi {{first_name}} - friendly reminder from Sasquatch Carpet Cleaning. We are scheduled at your home tomorrow, {{appointment_date}}, at {{start_time}}. If gate codes, parking, or entry details changed, just reply to this text and we will update your job notes.',
    0
  ),
  (
    'day_before_recovery_village_sms',
    'sms',
    'Day-Before Reminder (Recovery Village)',
    false,
    null,
    'Hello Recovery Village team - this is your 24-hour reminder from Sasquatch Carpet Cleaning. We are scheduled for tomorrow, {{appointment_date}}, at {{start_time}} at {{address_line}}. Work area: {{work_area}}. Please notify your on-site team that cleaning will be performed in this area, and reply with any access instructions or scheduling changes before arrival.',
    0
  )
ON CONFLICT (template_key) DO UPDATE
SET
  label = EXCLUDED.label,
  channel = EXCLUDED.channel,
  subject_template = EXCLUDED.subject_template,
  body_template = EXCLUDED.body_template;
