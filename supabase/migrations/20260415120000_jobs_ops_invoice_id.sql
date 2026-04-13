-- Link published map/social jobs back to ops invoices for stats deduplication.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS ops_invoice_id UUID REFERENCES ops_invoices(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_ops_invoice_id_unique
  ON jobs(ops_invoice_id)
  WHERE ops_invoice_id IS NOT NULL;

COMMENT ON COLUMN jobs.ops_invoice_id IS 'When set, utilization stats count this job instead of a duplicate ops row.';
