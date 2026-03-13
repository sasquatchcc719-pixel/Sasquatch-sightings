-- Shorten booking confirmation SMS to include total and drop the service list verbosity.
UPDATE ops_communication_templates
SET body_template = 'Hi {{first_name}} — your Sasquatch Carpet Cleaning appointment is confirmed for {{appointment_date}} at {{start_time}} at {{address_line}}. Estimated total: ${{quoted_total}}. See you then!'
WHERE template_key = 'job_scheduled_sms';
