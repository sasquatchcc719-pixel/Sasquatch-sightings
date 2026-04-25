-- Clean up customer-facing booking units and leather upholstery pricing.

UPDATE service_catalog_items
SET
  pricing_unit = 'per room',
  updated_at = now()
WHERE slug IN (
  'pet-urine-injection-treatment-with-bio-release',
  'pre-vacuuming'
);

UPDATE service_catalog_items
SET
  name = 'Leather Sectional',
  base_price = 75,
  pricing_unit = 'per seat',
  sort_order = 300,
  updated_at = now()
WHERE slug = 'sectional-leather';

UPDATE service_catalog_items
SET
  sort_order = CASE slug
    WHEN 'leather-cleaning-chair' THEN 297
    WHEN 'leather-cleaning-love-seat' THEN 298
    WHEN 'leather-cleaning-sofa' THEN 299
    ELSE sort_order
  END,
  updated_at = now()
WHERE slug IN (
  'leather-cleaning-chair',
  'leather-cleaning-love-seat',
  'leather-cleaning-sofa'
);
