-- Reactivation emails use the branded HTML button for the primary website CTA.

UPDATE reactivation_email_templates
SET
  body_template = replace(
    body_template,
    E'{{booking_url}}',
    'Use the button below to book online.'
  ),
  updated_at = now()
WHERE body_template LIKE '%{{booking_url}}%';
