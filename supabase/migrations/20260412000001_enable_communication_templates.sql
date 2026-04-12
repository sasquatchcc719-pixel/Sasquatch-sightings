UPDATE ops_communication_templates
SET is_enabled = true
WHERE template_key IN (
  'job_scheduled_email',
  'job_finished_email',
  'satisfaction_checkin_email'
);
