-- Track the original cron-generated date for recurring appointments.
-- When a job is moved to a different week the original slot must still be
-- blocked so the cron does not recreate a duplicate.
ALTER TABLE ops_appointments
  ADD COLUMN IF NOT EXISTS original_recurring_date date;

-- Backfill existing recurring appointments that haven't been moved yet
-- (appointment_date == original slot, so it's safe to use as the seed value).
UPDATE ops_appointments
SET original_recurring_date = appointment_date
WHERE recurring_template_id IS NOT NULL
  AND original_recurring_date IS NULL;

-- Index for the skip-check query in generateRecurringAppointments.
CREATE INDEX IF NOT EXISTS idx_ops_appointments_original_recurring_date
  ON ops_appointments (recurring_template_id, original_recurring_date)
  WHERE original_recurring_date IS NOT NULL;
