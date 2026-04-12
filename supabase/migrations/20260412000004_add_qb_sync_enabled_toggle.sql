ALTER TABLE quickbooks_oauth_tokens
  ADD COLUMN IF NOT EXISTS sync_enabled boolean NOT NULL DEFAULT true;
