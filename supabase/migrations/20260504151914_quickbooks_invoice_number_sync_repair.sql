-- Keep Sasquatch-generated invoice numbers above the existing QuickBooks range.
-- QuickBooks was audited on 2026-05-04; the highest numeric DocNumber was 18051.
SELECT setval(
  'public.sasquatch_invoice_number_seq',
  GREATEST((SELECT last_value FROM public.sasquatch_invoice_number_seq), 18051),
  true
);

-- Make QuickBooks sync retries observable instead of relying only on logs.
ALTER TABLE public.ops_quickbooks_sync_jobs
  ADD COLUMN IF NOT EXISTS sync_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ops_quickbooks_sync_jobs_invoice_active
  ON public.ops_quickbooks_sync_jobs (entity_id, status)
  WHERE entity_type = 'invoice';
