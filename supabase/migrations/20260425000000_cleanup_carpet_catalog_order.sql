-- Remove disallowed/retired carpet services from all active booking surfaces
-- and put the carpet-cleaning ladder in the requested customer-facing order.

UPDATE service_catalog_items
SET
  is_active = false,
  online_booking_enabled = false,
  updated_at = now()
WHERE slug IN (
  'carpet-protector',
  'heat-transfer-red-drink-dye-from-carpet'
)
OR name ILIKE '%carpet protector%'
OR name ILIKE '%heat transfer%';

UPDATE service_catalog_items
SET
  sort_order = CASE slug
    WHEN 'pet-urine-injection-treatment-with-bio-release' THEN 1
    WHEN 'step-carpet-cleaning-per-step-charge' THEN 2
    WHEN 'hall-bathroom-closet-carpet-cleaning-30-to-100-sqft' THEN 3
    WHEN 'regular-size-room-100-to-200-sqft' THEN 4
    WHEN 'sasquatch-size-room-200-to-400-sqft' THEN 5
    WHEN 'monster-size-room-400-to-600-sqft' THEN 6
    WHEN 'jumbo-humungous-room-600-to800-sqft' THEN 7
    WHEN 'oversized-room-carpet-cleaning-800-plus-sqft' THEN 8
    WHEN 'pre-vacuuming' THEN 9
    ELSE sort_order
  END,
  name = CASE slug
    WHEN 'jumbo-humungous-room-600-to800-sqft'
      THEN 'Jumbo Humongous Room (600 to 800 Sqft)'
    ELSE name
  END,
  updated_at = now()
WHERE slug IN (
  'pet-urine-injection-treatment-with-bio-release',
  'step-carpet-cleaning-per-step-charge',
  'hall-bathroom-closet-carpet-cleaning-30-to-100-sqft',
  'regular-size-room-100-to-200-sqft',
  'sasquatch-size-room-200-to-400-sqft',
  'monster-size-room-400-to-600-sqft',
  'jumbo-humungous-room-600-to800-sqft',
  'oversized-room-carpet-cleaning-800-plus-sqft',
  'pre-vacuuming'
);
