INSERT INTO service_catalog_items (
  name, slug, description, category, base_price, pricing_unit,
  is_active, online_booking_enabled, buffer_minutes, sort_order
)
VALUES (
  'Strip and Wax VCT', 'strip-and-wax-vct', 'Full strip and wax',
  'Hard Surface', 2.00, 'per_sq_ft', true, false, 0, 505
)
ON CONFLICT (slug) DO NOTHING;
