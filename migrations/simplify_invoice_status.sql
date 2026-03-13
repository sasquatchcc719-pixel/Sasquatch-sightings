-- Add payment_method to ops_invoices
ALTER TABLE ops_invoices
  ADD COLUMN IF NOT EXISTS payment_method text;

-- Migrate existing paid invoices
UPDATE ops_invoices
SET payment_method = 'venmo'
WHERE payment_status = 'paid' AND payment_method IS NULL;

-- Normalize status values to the simplified set
UPDATE ops_invoices SET status = 'pending' WHERE status IN ('draft', 'ready');
UPDATE ops_invoices SET status = 'paid'    WHERE payment_status = 'paid';
