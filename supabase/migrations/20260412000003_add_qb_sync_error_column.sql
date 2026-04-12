ALTER TABLE ops_quickbooks_sync_jobs
  ADD COLUMN IF NOT EXISTS error_message text;
