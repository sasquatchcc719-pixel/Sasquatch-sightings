-- Pre-Vacuuming was inserted with base_price = 0 and 10 mistakenly placed in default_duration_minutes.
-- Correct public/catalog price: $10 per room (aligns with sasquatch.com booking widget).

UPDATE service_catalog_items
SET
  base_price = 10,
  default_duration_minutes = 5,
  updated_at = now()
WHERE slug = 'pre-vacuuming'
   OR (name = 'Pre-Vacuuming' AND category = 'Carpet Cleaning');
