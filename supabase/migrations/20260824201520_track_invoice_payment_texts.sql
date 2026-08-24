-- Payment texts (Square / Venmo / QuickBooks / invoice SMS) were being logged
-- with the invoice UUID in sms_logs.lead_id. That column FKs to leads(id), so
-- every insert failed silently and invoices had no send history.
ALTER TABLE public.sms_logs
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.ops_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_by text;

CREATE INDEX IF NOT EXISTS idx_sms_logs_invoice_id
  ON public.sms_logs (invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sms_logs_payment_text_types
  ON public.sms_logs (message_type, sent_at DESC)
  WHERE message_type IN (
    'square_payment_link',
    'venmo_payment_link',
    'payment_link',
    'invoice_send'
  );

COMMENT ON COLUMN public.sms_logs.invoice_id IS
  'ops_invoices.id when this SMS is a payment link or invoice text.';
COMMENT ON COLUMN public.sms_logs.sent_by IS
  'Display name of the staff member who triggered the outbound SMS.';
