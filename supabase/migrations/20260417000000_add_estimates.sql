-- Add estimates feature
--
-- Estimates are modeled as a lightweight extension of ops_appointments (not a
-- separate table): an estimate is an appointment where kind='estimate'. The
-- measuring visit lives on the calendar with the same customer/address/line
-- item infrastructure. The only differences from a regular service booking:
--
--   * kind='estimate' => the booking pipeline skips ops_invoices creation.
--   * estimate_status drives the quote workflow (draft/sent/accepted/...).
--   * converted_appointment_id points to the service appointment a successful
--     estimate spawned.
--   * length_value/width_value on line items capture the dimensions the tech
--     measured on-site; quantity is usually (but not always) length * width.
--   * pricing_unit_snapshot pins the unit used at quote time so future catalog
--     edits don't distort historical estimates.

ALTER TABLE ops_appointments
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'service';

-- Replace any existing CHECK on kind (idempotent) with the explicit allowed set.
ALTER TABLE ops_appointments
  DROP CONSTRAINT IF EXISTS ops_appointments_kind_check;

ALTER TABLE ops_appointments
  ADD CONSTRAINT ops_appointments_kind_check
  CHECK (kind IN ('service', 'estimate'));

ALTER TABLE ops_appointments
  ADD COLUMN IF NOT EXISTS estimate_status TEXT;

ALTER TABLE ops_appointments
  DROP CONSTRAINT IF EXISTS ops_appointments_estimate_status_check;

ALTER TABLE ops_appointments
  ADD CONSTRAINT ops_appointments_estimate_status_check
  CHECK (
    estimate_status IS NULL
    OR estimate_status IN ('draft', 'sent', 'accepted', 'declined', 'converted')
  );

ALTER TABLE ops_appointments
  ADD COLUMN IF NOT EXISTS converted_appointment_id UUID
  REFERENCES ops_appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ops_appointments_kind
  ON ops_appointments(kind);

CREATE INDEX IF NOT EXISTS idx_ops_appointments_estimate_status
  ON ops_appointments(estimate_status)
  WHERE estimate_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ops_appointments_converted_from
  ON ops_appointments(converted_appointment_id)
  WHERE converted_appointment_id IS NOT NULL;

-- Line item dimensions
ALTER TABLE ops_appointment_line_items
  ADD COLUMN IF NOT EXISTS length_value NUMERIC(10, 2);

ALTER TABLE ops_appointment_line_items
  ADD COLUMN IF NOT EXISTS width_value NUMERIC(10, 2);

ALTER TABLE ops_appointment_line_items
  ADD COLUMN IF NOT EXISTS pricing_unit_snapshot TEXT;

COMMENT ON COLUMN ops_appointments.kind IS
  'service = billable job (default). estimate = measuring visit, invoice creation is skipped.';
COMMENT ON COLUMN ops_appointments.estimate_status IS
  'Only populated when kind=estimate. Drives the quote workflow.';
COMMENT ON COLUMN ops_appointments.converted_appointment_id IS
  'For kind=estimate rows: the service appointment this estimate produced when Charles pressed "Schedule the work".';
COMMENT ON COLUMN ops_appointment_line_items.length_value IS
  'Optional on-site measurement (e.g. 10 ft). Combined with width_value to derive quantity for sqft services.';
COMMENT ON COLUMN ops_appointment_line_items.width_value IS
  'Optional on-site measurement (e.g. 12 ft). See length_value.';
COMMENT ON COLUMN ops_appointment_line_items.pricing_unit_snapshot IS
  'Captured pricing_unit at time of entry (e.g. per_sqft, per_linear_foot, fixed) so historical line items stay accurate if the catalog changes.';
