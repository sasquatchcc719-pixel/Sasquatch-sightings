-- Warranty returns are complaint-resolution visits, not new cleaning jobs.
-- Give them their own customer lifecycle and keep $0 pricing, review asks,
-- marketing language, and the carpet-cleaning explainer out of the messages.
ALTER TABLE ops_communication_templates
  DROP CONSTRAINT IF EXISTS ops_communication_templates_template_key_check;

ALTER TABLE ops_communication_templates
  ADD CONSTRAINT ops_communication_templates_template_key_check
  CHECK (template_key = ANY (ARRAY[
    'job_scheduled_sms',
    'job_scheduled_warranty_sms',
    'on_my_way_sms',
    'on_my_way_estimate_sms',
    'on_my_way_warranty_sms',
    'job_finished_sms',
    'job_finished_warranty_sms',
    'job_rescheduled_sms',
    'job_rescheduled_warranty_sms',
    'job_rescheduled_email',
    'job_rescheduled_warranty_email',
    'day_before_residential_sms',
    'day_before_warranty_sms',
    'day_before_recovery_village_sms',
    'day_before_restoration_sms',
    'day_before_restoration_monitor_sms',
    'on_my_way_restoration_sms',
    'job_finished_restoration_sms',
    'job_finished_restoration_monitor_sms',
    'job_rescheduled_restoration_sms',
    'job_scheduled_email',
    'job_scheduled_warranty_email',
    'job_finished_email',
    'job_finished_warranty_email',
    'job_finished_email_urine',
    'satisfaction_checkin_email'
  ]));

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
    'job_scheduled_warranty_sms',
    'sms',
    'Warranty follow-up scheduled text',
    true,
    NULL,
    'Hi {{first_name}} — your no-charge warranty follow-up with Sasquatch Carpet Cleaning is scheduled for {{appointment_date}} at {{start_time}}.

This is a return visit to address the concern from your previous service; no payment is due.

Address:
{{address_line}}

Areas we are returning to:
{{service_list}}

If anything has changed with access or the affected area, just reply here.',
    0
  ),
  (
    'job_scheduled_warranty_email',
    'email',
    'Warranty follow-up scheduled email',
    true,
    'Your warranty follow-up is scheduled for {{appointment_date}}',
    'Hi {{first_name}},

Your no-charge warranty follow-up with {{company_name}} is scheduled for {{appointment_date}} between {{start_time}} and {{end_time}}.

This is a return visit to address the concern from your previous service, not a new cleaning appointment. No payment is due for this visit.

Areas we are returning to:
{{service_list}}

Service address:
{{address_line}}

If the affected area or access details have changed, please text us at (719) 249-8791.',
    0
  ),
  (
    'day_before_warranty_sms',
    'sms',
    'Day-before reminder (warranty follow-up)',
    true,
    NULL,
    'Hi {{first_name}}, this is Sasquatch Carpet Cleaning.

Reminder: your no-charge warranty follow-up is tomorrow, {{appointment_date}} at {{start_time}}.

Address:
{{address_line}}

Please leave the affected area accessible if possible. No payment is due. If anything has changed, just reply here.',
    0
  ),
  (
    'on_my_way_warranty_sms',
    'sms',
    'On my way text (warranty follow-up)',
    true,
    NULL,
    '{{tech_name}} from Sasquatch Carpet Cleaning is on the way for your warranty follow-up and should arrive shortly. If anything changed with access or the affected area, just reply here.',
    0
  ),
  (
    'job_rescheduled_warranty_sms',
    'sms',
    'Warranty follow-up rescheduled text',
    true,
    NULL,
    'Hi {{first_name}} — your no-charge Sasquatch warranty follow-up has been moved to {{appointment_date}} at {{start_time}}.

Address:
{{address_line}}

No payment is due. Questions or changes? Just reply here.',
    0
  ),
  (
    'job_rescheduled_warranty_email',
    'email',
    'Warranty follow-up rescheduled email',
    true,
    'Your warranty follow-up has been rescheduled for {{appointment_date}}',
    'Hi {{first_name}},

Your no-charge warranty follow-up with {{company_name}} has been rescheduled for {{appointment_date}} between {{start_time}} and {{end_time}}.

Service address:
{{address_line}}

No payment is due for this visit. To make another change, please text us at (719) 249-8791.',
    0
  ),
  (
    'job_finished_warranty_sms',
    'sms',
    'Warranty follow-up finished text',
    true,
    NULL,
    'Hi {{first_name}}, we finished today''s warranty follow-up. Please let the treated area dry completely before judging the result; urine or odor treatments may need a full 48 hours. If the original concern is still present after that, reply here and tell us exactly what remains. No payment is due for today''s visit.',
    0
  ),
  (
    'job_finished_warranty_email',
    'email',
    'Warranty follow-up finished email',
    true,
    'Your Sasquatch warranty follow-up is complete',
    'Hi {{first_name}},

We completed today''s warranty follow-up at:
{{address_line}}

Please allow the treated area to dry completely before judging the final result. Most areas need 12 to 24 hours. If the concern involved urine or odor treatment, allow a full 48 hours because the treatment continues working while it remains damp and the odor can temporarily become stronger as it dries.

If the original concern is still present after the appropriate drying time, reply to this email or text (719) 249-8791 and tell us the exact room or area and what remains. Photos are helpful for a visible spot.

There is no charge for today''s warranty follow-up.

— {{company_name}}',
    0
  )
ON CONFLICT (template_key) DO NOTHING;
