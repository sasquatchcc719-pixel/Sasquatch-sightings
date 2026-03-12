INSERT INTO harry_control_settings (
  setting_key,
  group_key,
  label,
  description,
  is_enabled
)
VALUES (
  'booking_use_ops_link_enabled',
  'booking',
  'Use Ops Booking Destination',
  'Booking link destination switch for Harry SMS replies only. OFF uses website booking URL; ON uses ops booking URL from env. Does not update website CTA buttons or referral SMS templates yet.',
  false
)
ON CONFLICT (setting_key) DO UPDATE
SET
  group_key = EXCLUDED.group_key,
  label = EXCLUDED.label,
  description = EXCLUDED.description;
