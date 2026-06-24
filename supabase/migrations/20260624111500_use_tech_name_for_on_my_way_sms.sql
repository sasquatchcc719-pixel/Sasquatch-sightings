-- On-my-way messages must use the appointment's assigned technician.
UPDATE ops_communication_templates
SET body_template = replace(
  body_template,
  'Charles from Sasquatch Carpet Cleaning is on the way and should arrive shortly!',
  '{{tech_name}} from Sasquatch Carpet Cleaning is on the way and should arrive shortly!'
)
WHERE template_key = 'on_my_way_sms';
