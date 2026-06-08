-- Reactivation emails should not invite replies when the inbox is not an
-- automated booking channel.

UPDATE reactivation_email_templates
SET
  body_template = replace(
    replace(
      body_template,
      'Or just reply to this email and we''ll help get you set up.',
      'Or text/call us at (719) 249-8791 and we''ll help get you set up.'
    ),
    'and fewer I thought I replied to that moments',
    'and fewer I thought I handled that moments'
  ),
  updated_at = now()
WHERE template_key = 'reconnect_system_upgrade';

UPDATE reactivation_email_templates
SET
  body_template = replace(
    body_template,
    'Or reply to this email and we''ll help you find a time.',
    'Or text/call us at (719) 249-8791 and we''ll help you find a time.'
  ),
  updated_at = now()
WHERE template_key = 'standing_offer_twenty';
