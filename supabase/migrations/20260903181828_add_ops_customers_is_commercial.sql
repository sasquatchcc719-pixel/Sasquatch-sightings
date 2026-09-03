-- Explicit commercial designation on customers.
-- Reporting already treats non-empty business_name as commercial; this flag
-- lets admin booking toggle it without inventing a fake lead source.
ALTER TABLE public.ops_customers
  ADD COLUMN IF NOT EXISTS is_commercial boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ops_customers.is_commercial IS
  'True for commercial accounts (Recovery Village, Mission Training, etc.). Separate from lead_source — used by revenue attribution and Channel P&L.';

UPDATE public.ops_customers
SET is_commercial = true
WHERE is_commercial = false
  AND NULLIF(TRIM(business_name), '') IS NOT NULL;
