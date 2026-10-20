-- The existing token table is service-role-only (RLS enabled, no public policy).
-- A database lease coordinates renewal across independent Vercel workers.
ALTER TABLE public.quickbooks_oauth_tokens
  ADD COLUMN IF NOT EXISTS refresh_lock_id uuid,
  ADD COLUMN IF NOT EXISTS refresh_lock_until timestamptz,
  ADD COLUMN IF NOT EXISTS auth_error text;
