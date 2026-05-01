ALTER TABLE ops_quickbooks_sync_jobs
  DROP CONSTRAINT IF EXISTS ops_quickbooks_sync_jobs_entity_type_check;

ALTER TABLE ops_quickbooks_sync_jobs
  ADD CONSTRAINT ops_quickbooks_sync_jobs_entity_type_check
  CHECK (entity_type IN ('customer', 'invoice', 'batch_invoice'));
