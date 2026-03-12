ALTER TABLE service_catalog_items
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY name) AS next_sort_order
  FROM service_catalog_items
)
UPDATE service_catalog_items AS services
SET sort_order = ranked.next_sort_order
FROM ranked
WHERE services.id = ranked.id
  AND services.sort_order IS NULL;

CREATE INDEX IF NOT EXISTS idx_service_catalog_items_sort_order
  ON service_catalog_items(sort_order, name);
