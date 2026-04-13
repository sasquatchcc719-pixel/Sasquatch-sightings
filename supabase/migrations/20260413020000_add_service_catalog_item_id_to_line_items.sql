ALTER TABLE ops_invoice_line_items
ADD COLUMN IF NOT EXISTS service_catalog_item_id uuid REFERENCES service_catalog_items(id) ON DELETE SET NULL;
