-- Raise current customer-bookable small area and urine treatment prices.

UPDATE service_catalog_items
SET
  base_price = 30,
  updated_at = now()
WHERE slug IN (
  'hall-bathroom-closet-carpet-cleaning-30-to-100-sqft',
  'pet-urine-injection-treatment-with-bio-release'
);
