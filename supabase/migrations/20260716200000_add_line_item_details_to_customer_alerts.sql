-- Show a clear quantity, description, and line price in appointment alerts,
-- followed by the estimated total. Also finish the customer-facing small-area
-- rename in historical snapshots that still feed the app and invoices.

UPDATE service_catalog_items
SET
  name = 'Small Area / Walk-in Closet (up to 100 sq ft)',
  updated_at = now()
WHERE name ~* '^Hall[[:space:]]*/[[:space:]]*Bathroom[[:space:]]*/[[:space:]]*Closet';

UPDATE ops_appointment_line_items
SET name_snapshot = 'Small Area / Walk-in Closet (up to 100 sq ft)'
WHERE name_snapshot ~* '^Hall[[:space:]]*/[[:space:]]*Bathroom[[:space:]]*/[[:space:]]*Closet';

UPDATE ops_invoice_line_items
SET description = 'Small Area / Walk-in Closet (up to 100 sq ft)'
WHERE description ~* '^Hall[[:space:]]*/[[:space:]]*Bathroom[[:space:]]*/[[:space:]]*Closet';

UPDATE ops_communication_templates
SET body_template = 'Hi {{first_name}} — your Sasquatch Carpet Cleaning appointment is confirmed for {{appointment_date}} at {{start_time}}.

Address:
{{address_line}}

Services:
{{service_summary}}

Estimated total: ${{quoted_total}}

See you then!'
WHERE template_key = 'job_scheduled_sms';

UPDATE ops_communication_templates
SET body_template = 'Hi {{first_name}} — your Sasquatch Carpet Cleaning appointment has been rescheduled to {{appointment_date}} at {{start_time}}.

Address:
{{address_line}}

Services:
{{service_summary}}

Estimated total: ${{quoted_total}}

Questions? Just reply here.'
WHERE template_key = 'job_rescheduled_sms';

UPDATE ops_communication_templates
SET body_template = 'Hi {{first_name}}, this is Sasquatch Carpet Cleaning.

Reminder: we are scheduled for tomorrow, {{appointment_date}} at {{start_time}}.

Address:
{{address_line}}

Services:
{{service_summary}}

Estimated total: ${{quoted_total}}

If anything has changed with access, parking, gate codes, or service details, just reply here.'
WHERE template_key = 'day_before_residential_sms';

UPDATE ops_communication_templates
SET body_template = 'Hello Recovery Village team — this is your 24-hour reminder from Sasquatch Carpet Cleaning.

We are scheduled for tomorrow, {{appointment_date}} at {{start_time}}.

Address:
{{address_line}}

Services:
{{service_summary}}

Estimated total: ${{quoted_total}}

Work area:
{{work_area}}

Please notify your on-site team that cleaning will be performed in this area, and reply with any access instructions or scheduling changes before arrival.'
WHERE template_key = 'day_before_recovery_village_sms';

UPDATE ops_communication_templates
SET body_template = 'Hi {{first_name}},

Your appointment with {{company_name}} is confirmed for {{appointment_date}} between {{start_time}} and {{end_time}}.

Services:
{{service_summary}}

Estimated total: ${{quoted_total}}

Service address:
{{address_line}}

To make any changes, please text us at (719) 249-8791.'
WHERE template_key = 'job_scheduled_email';

UPDATE ops_communication_templates
SET body_template = 'Hi {{first_name}},

Your appointment with {{company_name}} has been rescheduled for {{appointment_date}} between {{start_time}} and {{end_time}}.

Services:
{{service_summary}}

Estimated total: ${{quoted_total}}

Service address:
{{address_line}}

To make any changes, please text us at (719) 249-8791.'
WHERE template_key = 'job_rescheduled_email';
