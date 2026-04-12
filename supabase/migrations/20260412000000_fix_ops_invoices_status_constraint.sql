ALTER TABLE ops_invoices DROP CONSTRAINT ops_invoices_status_check;
ALTER TABLE ops_invoices ADD CONSTRAINT ops_invoices_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'ready'::text, 'pending'::text, 'sent'::text, 'paid'::text, 'void'::text]));
