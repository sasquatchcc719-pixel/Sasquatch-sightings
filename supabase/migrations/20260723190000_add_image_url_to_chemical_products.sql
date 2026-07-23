-- Product photo for visual matching in the field — David matches the bottle
-- on the truck to the thumbnail instead of reading labels. Populated from the
-- supplier page (og:image / catalog image) by the spec scraper.

alter table chemical_products
  add column if not exists image_url text;
