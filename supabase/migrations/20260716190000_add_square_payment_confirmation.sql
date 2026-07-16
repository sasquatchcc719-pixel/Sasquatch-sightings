-- Correlate a Square-hosted payment link to its resulting Payment webhook and
-- record one Telegram confirmation for the completed payment.
ALTER TABLE public.ops_invoices
  ADD COLUMN IF NOT EXISTS square_payment_link_id text,
  ADD COLUMN IF NOT EXISTS square_order_id text,
  ADD COLUMN IF NOT EXISTS square_payment_id text,
  ADD COLUMN IF NOT EXISTS square_payment_event_id text,
  ADD COLUMN IF NOT EXISTS square_paid_cents integer,
  ADD COLUMN IF NOT EXISTS square_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS square_telegram_notification_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS square_telegram_notified_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_invoices_square_order_id
  ON public.ops_invoices(square_order_id)
  WHERE square_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_invoices_square_payment_id
  ON public.ops_invoices(square_payment_id)
  WHERE square_payment_id IS NOT NULL;

COMMENT ON COLUMN public.ops_invoices.square_order_id IS
  'Square Order ID returned with the hosted payment link; used to match payment.updated webhooks.';
COMMENT ON COLUMN public.ops_invoices.square_telegram_notified_at IS
  'When the owner Telegram confirmation for the completed Square payment was sent.';
