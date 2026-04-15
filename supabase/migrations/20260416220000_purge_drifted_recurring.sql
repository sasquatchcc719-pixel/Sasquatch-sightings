-- Purge future recurring appointments created by the date-drift bug.
-- Only removes booked/confirmed appointments (preserves completed, on_my_way, cancelled).
-- The fixed generator will recreate them on the correct dates.

BEGIN;

CREATE TEMP TABLE _purge AS
SELECT id
FROM ops_appointments
WHERE recurring_template_id IS NOT NULL
  AND appointment_date >= CURRENT_DATE
  AND status IN ('booked', 'confirmed');

DO $$
DECLARE cnt INT;
BEGIN
  SELECT count(*) INTO cnt FROM _purge;
  RAISE NOTICE 'Purging % future recurring appointments for regeneration', cnt;
END $$;

DELETE FROM ops_invoice_line_items
WHERE invoice_id IN (
  SELECT id FROM ops_invoices WHERE appointment_id IN (SELECT id FROM _purge)
);

DELETE FROM ops_invoices
WHERE appointment_id IN (SELECT id FROM _purge);

DELETE FROM ops_appointment_line_items
WHERE appointment_id IN (SELECT id FROM _purge);

DELETE FROM ops_appointment_status_events
WHERE appointment_id IN (SELECT id FROM _purge);

DELETE FROM ops_appointments
WHERE id IN (SELECT id FROM _purge);

DROP TABLE _purge;

COMMIT;
