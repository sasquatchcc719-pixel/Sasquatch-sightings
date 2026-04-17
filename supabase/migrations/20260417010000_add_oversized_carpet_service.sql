-- Add the missing residential per-sqft tier for rooms over 800 sqft.
--
-- Harry's system prompt tells customers "over 800 sq ft = $0.25/sq ft," but
-- the only per-sqft carpet catalog items are the "Commercial carpet cleaning"
-- ($0.35) and "Low Moisture Encapsulation" ($0.28), both of which are
-- explicitly excluded from SMS + public booking. That left Harry with no
-- service_id to pass to book_new_job for oversized residential rooms.
--
-- This migration adds the residential $0.25/sqft tier as a normal Carpet
-- Cleaning catalog item so Harry can book it (and the estimates workspace
-- can use its per_sqft pricing with length x width math).

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
  'Oversized Room Carpet Cleaning (800+ sqft)',
  'oversized-room-carpet-cleaning-800-plus-sqft',
  'Residential carpet cleaning for rooms over 800 sqft (great rooms, open-plan basements, large finished lofts). Billed at $0.25/sqft — quantity = measured sqft.',
  'Carpet Cleaning',
  45,
  30,
  0.25,
  'per_sqft',
  true,
  false,
  13
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
