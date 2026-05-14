-- Remove the "reply to this email" line from the booking confirmation.
-- Customers should text Harry for changes, not reply to the no-reply address.
UPDATE ops_communication_templates
SET body_template =
  'Hi {{first_name}},

Your appointment with {{company_name}} is confirmed for {{appointment_date}} between {{start_time}} and {{end_time}}.

Services:
{{service_summary}}

Service address:
{{address_line}}

To make any changes, text Harry at (719) 249-8791 — he''s available 24/7.'
WHERE template_key = 'job_scheduled_email';
