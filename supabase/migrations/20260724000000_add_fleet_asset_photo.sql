-- Reference photo per fleet asset (e.g. "this is Blue Van", "this is
-- Truckmount #1") so techs can visually confirm they're logging hours
-- against the right piece of equipment. Same idea as chemical_products
-- product photos, uploaded rather than scraped.

alter table fleet_assets
  add column if not exists image_url text;
