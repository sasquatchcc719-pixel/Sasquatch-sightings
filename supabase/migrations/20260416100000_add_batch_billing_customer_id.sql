-- Allows one-off appointments to be included in a customer's monthly batch invoice.
-- When set, the appointment is gathered into the Month-End Billing alongside
-- recurring template appointments for that customer.
ALTER TABLE ops_appointments
  ADD COLUMN IF NOT EXISTS batch_billing_customer_id UUID
    REFERENCES ops_customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ops_appointments_batch_billing_customer
  ON ops_appointments(batch_billing_customer_id)
  WHERE batch_billing_customer_id IS NOT NULL;
