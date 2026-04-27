-- Add signature fields to ops_invoices table
ALTER TABLE ops_invoices
ADD COLUMN IF NOT EXISTS signature_url TEXT,
ADD COLUMN IF NOT EXISTS signature_captured_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS signature_customer_name TEXT;

-- Add comment
COMMENT ON COLUMN ops_invoices.signature_url IS 'Supabase Storage URL for customer signature image';
COMMENT ON COLUMN ops_invoices.signature_captured_at IS 'When the customer signed';
COMMENT ON COLUMN ops_invoices.signature_customer_name IS 'Name entered by customer when signing';
