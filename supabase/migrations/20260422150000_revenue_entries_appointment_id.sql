-- Allow revenue_entries to link directly to an appointment when no invoice
-- exists (e.g. batch_monthly recurring jobs like Recovery Village).
-- Used for idempotency on the auto-record path.

ALTER TABLE revenue_entries
  ADD COLUMN IF NOT EXISTS ops_appointment_id uuid
    REFERENCES ops_appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS revenue_entries_ops_appointment_id_idx
  ON revenue_entries (ops_appointment_id);
