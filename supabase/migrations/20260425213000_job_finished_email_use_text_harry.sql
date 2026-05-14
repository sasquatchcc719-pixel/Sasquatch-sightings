-- Job-finished email should direct customers to text Harry, not reply by email.
UPDATE ops_communication_templates
SET body_template = replace(
  body_template,
  'If anything is not 100% legendary, please reply to this email or call us directly so we can make it right.',
  'If anything is not 100% legendary, text Harry at (719) 249-8791 and we will make it right.'
)
WHERE template_key = 'job_finished_email';
