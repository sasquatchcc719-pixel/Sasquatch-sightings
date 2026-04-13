-- ============================================================
-- Fix service catalog: correct prices + add missing services
-- Run in Supabase SQL editor
-- ============================================================

-- 1. Fix tile & grout price ($0.65 → $0.75/sqft)
UPDATE service_catalog_items
SET base_price = 0.75, updated_at = now()
WHERE name ILIKE '%tile%grout%';

-- 2. Fix the single Deep Restoration entry to be the "Regular Room" size
--    and rename it to match the legendary tier naming
UPDATE service_catalog_items
SET
  name = 'Legendary Restoration — Regular Room (100-200 sqft)',
  base_price = 75,
  pricing_unit = 'per room',
  category = 'Legendary Restoration Clean',
  updated_at = now()
WHERE name = 'Deep Restoration Carpet Cleaning';

-- 3. Insert the full Legendary Restoration Clean price ladder
INSERT INTO service_catalog_items (name, slug, category, base_price, pricing_unit, default_duration_minutes, buffer_minutes, online_booking_enabled, is_active, sort_order)
VALUES
  ('Legendary Restoration — Step/Landing',                   'legendary-step',        'Legendary Restoration Clean', 6,   'per step', 5,  30, true, true, 200),
  ('Legendary Restoration — Small Area/Hall/Closet (50-100 sqft)', 'legendary-hall', 'Legendary Restoration Clean', 50,  'per room', 30, 30, true, true, 201),
  ('Legendary Restoration — Sasquatch Size Room (200-400 sqft)',   'legendary-sasquatch', 'Legendary Restoration Clean', 145, 'per room', 60, 30, true, true, 203),
  ('Legendary Restoration — Monster Size Room (400-600 sqft)',     'legendary-monster',   'Legendary Restoration Clean', 210, 'per room', 90, 30, true, true, 204),
  ('Legendary Restoration — Jumbo Humongous Room (600-800 sqft)',  'legendary-jumbo',     'Legendary Restoration Clean', 265, 'per room', 120,30, true, true, 205)
ON CONFLICT (slug) DO UPDATE SET
  base_price = EXCLUDED.base_price,
  updated_at = now();

-- 4. Insert Carpet Protector and Pre-Vacuuming add-ons
INSERT INTO service_catalog_items (name, slug, category, base_price, pricing_unit, default_duration_minutes, buffer_minutes, online_booking_enabled, is_active, sort_order)
VALUES
  ('Carpet Protector', 'carpet-protector', 'Carpet Cleaning', 25, 'per room', 5, 0, true, true, 50),
  ('Pre-Vacuuming',    'pre-vacuuming',    'Carpet Cleaning', 0,  'per room', 10, 0, true, true, 51)
ON CONFLICT (slug) DO UPDATE SET
  base_price = EXCLUDED.base_price,
  updated_at = now();
