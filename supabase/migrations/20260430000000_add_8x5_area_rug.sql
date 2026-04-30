-- Add 8x5 area rug option to service catalog
-- Customer-facing booking forms and widget

INSERT INTO service_catalog_items (
  name,
  slug,
  description,
  category,
  default_duration_minutes,
  buffer_minutes,
  base_price,
  pricing_unit,
  is_active,
  online_booking_enabled,
  sort_order
)
VALUES (
  'Area Rug 8x5',
  'area-rug-8x5',
  'Professional cleaning for 8x5 area rug',
  'rug cleaning',
  30,
  30,
  32.00,
  'per rug',
  true,
  true,
  410
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  default_duration_minutes = EXCLUDED.default_duration_minutes,
  buffer_minutes = EXCLUDED.buffer_minutes,
  base_price = EXCLUDED.base_price,
  pricing_unit = EXCLUDED.pricing_unit,
  is_active = EXCLUDED.is_active,
  online_booking_enabled = EXCLUDED.online_booking_enabled,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();
