-- Checkout upsells and scoped invoice discounts

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
  'Free UV Inspection',
  'free-uv-inspection',
  'We will check your carpet with a UV light for pet-related trouble spots and point out anything worth treating. Inspection only; treatment is quoted separately if needed.',
  'Checkout Upsells',
  0,
  0,
  0.00,
  'fixed',
  true,
  true,
  10
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

ALTER TABLE ops_invoices
  ADD COLUMN IF NOT EXISTS percentage_discount_label TEXT,
  ADD COLUMN IF NOT EXISTS percentage_discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS percentage_discount_scope TEXT,
  ADD COLUMN IF NOT EXISTS percentage_discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
