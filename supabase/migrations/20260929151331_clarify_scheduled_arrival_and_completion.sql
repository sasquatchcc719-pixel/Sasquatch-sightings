-- A calendar block describes when work starts and its estimated duration. It is
-- not an arrival window. Give customers one scheduled arrival time, a separate
-- estimated completion time, and a realistic afternoon-delay expectation.
UPDATE ops_communication_templates AS template
SET body_template = replacement.body_template
FROM (
  VALUES
    (
      'job_scheduled_sms',
      $body$Hi {{first_name}} — your Sasquatch Carpet Cleaning appointment is confirmed for {{appointment_date}}.

Scheduled arrival: {{start_time}}
Estimated completion: {{end_time}}

We plan to arrive at the scheduled time. {{arrival_note}}

Address:
{{address_line}}

Services:
{{service_summary}}

Estimated total: ${{quoted_total}}

See you then!$body$
    ),
    (
      'job_rescheduled_sms',
      $body$Hi {{first_name}} — your Sasquatch Carpet Cleaning appointment has been rescheduled for {{appointment_date}}.

Scheduled arrival: {{start_time}}
Estimated completion: {{end_time}}

We plan to arrive at the scheduled time. {{arrival_note}}

Address:
{{address_line}}

Services:
{{service_summary}}

Estimated total: ${{quoted_total}}

Questions? Just reply here.$body$
    ),
    (
      'day_before_residential_sms',
      $body$Hi {{first_name}}, this is Sasquatch Carpet Cleaning.

Reminder: your appointment is tomorrow, {{appointment_date}}.

Scheduled arrival: {{start_time}}
Estimated completion: {{end_time}}

We plan to arrive at the scheduled time. {{arrival_note}}

Address:
{{address_line}}

Services:
{{service_summary}}

Estimated total: ${{quoted_total}}

If anything has changed with access, parking, gate codes, or service details, just reply here.$body$
    ),
    (
      'day_before_recovery_village_sms',
      $body$Hello Recovery Village team — this is your 24-hour reminder from Sasquatch Carpet Cleaning.

Your appointment is tomorrow, {{appointment_date}}.

Scheduled arrival: {{start_time}}
Estimated completion: {{end_time}}

We plan to arrive at the scheduled time. {{arrival_note}}

Address:
{{address_line}}

Services:
{{service_summary}}

Estimated total: ${{quoted_total}}

Work area:
{{work_area}}

Please notify your on-site team that cleaning will be performed in this area, and reply with any access instructions or scheduling changes before arrival.$body$
    ),
    (
      'job_scheduled_email',
      $body$Hi {{first_name}},

Your appointment with {{company_name}} is confirmed for {{appointment_date}}.

Scheduled arrival: {{start_time}}
Estimated completion: {{end_time}}

We plan to arrive at the scheduled time. {{arrival_note}}

Services:
{{service_summary}}

Estimated total: ${{quoted_total}}

Service address:
{{address_line}}

To make any changes, please text us at (719) 249-8791.$body$
    ),
    (
      'job_rescheduled_email',
      $body$Hi {{first_name}},

Your appointment with {{company_name}} has been rescheduled for {{appointment_date}}.

Scheduled arrival: {{start_time}}
Estimated completion: {{end_time}}

We plan to arrive at the scheduled time. {{arrival_note}}

Services:
{{service_summary}}

Estimated total: ${{quoted_total}}

Service address:
{{address_line}}

To make any changes, please text us at (719) 249-8791.$body$
    ),
    (
      'job_scheduled_warranty_sms',
      $body$Hi {{first_name}} — your no-charge warranty follow-up with Sasquatch Carpet Cleaning is scheduled for {{appointment_date}}.

Scheduled arrival: {{start_time}}
Estimated completion: {{end_time}}

We plan to arrive at the scheduled time. {{arrival_note}}

This is a return visit to address the concern from your previous service; no payment is due.

Address:
{{address_line}}

Areas we are returning to:
{{service_list}}

If anything has changed with access or the affected area, just reply here.$body$
    ),
    (
      'job_scheduled_warranty_email',
      $body$Hi {{first_name}},

Your no-charge warranty follow-up with {{company_name}} is scheduled for {{appointment_date}}.

Scheduled arrival: {{start_time}}
Estimated completion: {{end_time}}

We plan to arrive at the scheduled time. {{arrival_note}}

This is a return visit to address the concern from your previous service, not a new cleaning appointment. No payment is due for this visit.

Areas we are returning to:
{{service_list}}

Service address:
{{address_line}}

If the affected area or access details have changed, please text us at (719) 249-8791.$body$
    ),
    (
      'job_rescheduled_warranty_sms',
      $body$Hi {{first_name}} — your no-charge Sasquatch warranty follow-up has been moved to {{appointment_date}}.

Scheduled arrival: {{start_time}}
Estimated completion: {{end_time}}

We plan to arrive at the scheduled time. {{arrival_note}}

Address:
{{address_line}}

No payment is due. Questions or changes? Just reply here.$body$
    ),
    (
      'job_rescheduled_warranty_email',
      $body$Hi {{first_name}},

Your no-charge warranty follow-up with {{company_name}} has been rescheduled for {{appointment_date}}.

Scheduled arrival: {{start_time}}
Estimated completion: {{end_time}}

We plan to arrive at the scheduled time. {{arrival_note}}

Service address:
{{address_line}}

No payment is due for this visit. To make another change, please text us at (719) 249-8791.$body$
    ),
    (
      'day_before_warranty_sms',
      $body$Hi {{first_name}}, this is Sasquatch Carpet Cleaning.

Reminder: your no-charge warranty follow-up is tomorrow, {{appointment_date}}.

Scheduled arrival: {{start_time}}
Estimated completion: {{end_time}}

We plan to arrive at the scheduled time. {{arrival_note}}

Address:
{{address_line}}

Please leave the affected area accessible if possible. No payment is due. If anything has changed, just reply here.$body$
    ),
    (
      'day_before_restoration_monitor_sms',
      $body$Hi {{first_name}}, this is Sasquatch Carpet Cleaning.

We will be by tomorrow, {{appointment_date}}, to check the drying equipment and take moisture readings.

Scheduled arrival: {{start_time}}
Estimated completion: {{end_time}}

We plan to arrive at the scheduled time. {{arrival_note}}

Address:
{{address_line}}

You do not need to be home as long as we can reach the equipment. If anything has changed with access, just reply here.$body$
    ),
    (
      'day_before_restoration_sms',
      $body$Hi {{first_name}}, this is Sasquatch Carpet Cleaning.

Your water-damage appointment is tomorrow, {{appointment_date}}.

Scheduled arrival: {{start_time}}
Estimated completion: {{end_time}}

We plan to arrive at the scheduled time. {{arrival_note}}

Address:
{{address_line}}

If you can, please clear a path to the affected area. If anything has changed with access, parking, or gate codes, just reply here.$body$
    ),
    (
      'job_rescheduled_restoration_sms',
      $body$Hi {{first_name}} — your Sasquatch Carpet Cleaning visit has been moved to {{appointment_date}}.

Scheduled arrival: {{start_time}}
Estimated completion: {{end_time}}

We plan to arrive at the scheduled time. {{arrival_note}}

Address:
{{address_line}}

Questions? Just reply here.$body$
    )
) AS replacement(template_key, body_template)
WHERE template.template_key = replacement.template_key;
