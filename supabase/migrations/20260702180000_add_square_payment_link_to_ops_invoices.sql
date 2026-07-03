-- Store the Square payment link created for an invoice so the public /pay
-- page can reuse it instead of re-creating it. Re-creating hits Square's
-- idempotency-key protection (same key, different body -> IDEMPOTENCY_KEY_REUSED)
-- and broke every texted Square link.
ALTER TABLE ops_invoices
  ADD COLUMN IF NOT EXISTS square_payment_link_url text,
  ADD COLUMN IF NOT EXISTS square_payment_link_cents integer;
