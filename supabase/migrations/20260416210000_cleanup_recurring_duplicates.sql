-- Clean up duplicate recurring appointments created by the date-drift bug
-- in expandRule (custom/biweekly cursors anchored to today instead of effective_from).
--
-- For each (recurring_template_id, appointment_date) group with >1 row,
-- keep the "best" row (prefer completed > on_my_way > confirmed > booked,
-- then earliest created_at) and delete the rest.
-- Also cascade-delete their line items, invoices, invoice line items, and status events.

BEGIN;

-- Identify which appointment to KEEP per template+date pair
CREATE TEMP TABLE _keep_ids AS
SELECT DISTINCT ON (recurring_template_id, appointment_date) id
FROM ops_appointments
WHERE recurring_template_id IS NOT NULL
ORDER BY
  recurring_template_id,
  appointment_date,
  CASE status
    WHEN 'completed'  THEN 0
    WHEN 'on_my_way'  THEN 1
    WHEN 'confirmed'  THEN 2
    WHEN 'booked'     THEN 3
    ELSE 4
  END,
  created_at ASC;

-- Collect duplicates to remove
CREATE TEMP TABLE _dupes AS
SELECT a.id
FROM ops_appointments a
WHERE a.recurring_template_id IS NOT NULL
  AND a.id NOT IN (SELECT id FROM _keep_ids)
  AND EXISTS (
    SELECT 1 FROM ops_appointments b
    WHERE b.recurring_template_id = a.recurring_template_id
      AND b.appointment_date = a.appointment_date
      AND b.id <> a.id
  );

-- Report how many duplicates will be removed
DO $$
DECLARE cnt INT;
BEGIN
  SELECT count(*) INTO cnt FROM _dupes;
  RAISE NOTICE 'Removing % duplicate recurring appointments', cnt;
END $$;

-- Delete related records first (child tables)
DELETE FROM ops_invoice_line_items
WHERE invoice_id IN (
  SELECT id FROM ops_invoices WHERE appointment_id IN (SELECT id FROM _dupes)
);

DELETE FROM ops_invoices
WHERE appointment_id IN (SELECT id FROM _dupes);

DELETE FROM ops_appointment_line_items
WHERE appointment_id IN (SELECT id FROM _dupes);

DELETE FROM ops_appointment_status_events
WHERE appointment_id IN (SELECT id FROM _dupes);

-- Delete the duplicate appointments themselves
DELETE FROM ops_appointments
WHERE id IN (SELECT id FROM _dupes);

DROP TABLE _dupes;
DROP TABLE _keep_ids;

COMMIT;
