-- Link revenue entries to ops invoices (idempotent stats) and optional drive time for utilization.
ALTER TABLE revenue_entries
  ADD COLUMN IF NOT EXISTS ops_invoice_id UUID REFERENCES ops_invoices(id) ON DELETE SET NULL;

ALTER TABLE revenue_entries
  ADD COLUMN IF NOT EXISTS drive_minutes INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_revenue_entries_ops_invoice_unique
  ON revenue_entries(ops_invoice_id)
  WHERE ops_invoice_id IS NOT NULL;

COMMENT ON COLUMN revenue_entries.ops_invoice_id IS 'When set, this row is the stats record for that ops invoice (avoid duplicates).';
COMMENT ON COLUMN revenue_entries.drive_minutes IS 'Optional drive time from on-my-way; added to hours for utilization stats.';
