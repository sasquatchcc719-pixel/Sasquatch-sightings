-- ============================================
-- SERVICE CATALOG IMPORT / EDIT SUPPORT
-- ============================================

ALTER TABLE service_catalog_items
  ALTER COLUMN default_duration_minutes DROP NOT NULL,
  ALTER COLUMN default_duration_minutes DROP DEFAULT,
  DROP CONSTRAINT IF EXISTS service_catalog_items_default_duration_minutes_check;

ALTER TABLE service_catalog_items
  ADD COLUMN IF NOT EXISTS online_booking_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS source_uuid TEXT,
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;

ALTER TABLE service_catalog_items
  ALTER COLUMN buffer_minutes SET DEFAULT 30;

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_catalog_items_source_uuid
  ON service_catalog_items(source_uuid)
  WHERE source_uuid IS NOT NULL;
