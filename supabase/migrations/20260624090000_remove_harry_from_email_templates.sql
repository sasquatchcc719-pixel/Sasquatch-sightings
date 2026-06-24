-- Remove Harry-specific language from booking confirmation emails.
UPDATE ops_communication_templates
SET body_template =
  'Hi {{first_name}},

Your appointment with {{company_name}} is confirmed for {{appointment_date}} between {{start_time}} and {{end_time}}.

Services:
{{service_summary}}

Service address:
{{address_line}}

To make any changes, please text us at (719) 249-8791.'
WHERE template_key = 'job_scheduled_email';

UPDATE ops_communication_templates
SET body_template = replace(
  body_template,
  'If anything is not 100% legendary, text Harry at (719) 249-8791 and we will make it right.',
  'If anything is not 100% legendary, please text us at (719) 249-8791 and we will make it right.'
)
WHERE template_key = 'job_finished_email';
