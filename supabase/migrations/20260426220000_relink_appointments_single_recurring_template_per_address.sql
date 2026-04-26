-- Re-attach ops_appointments.recurring_template_id when it was cleared by the old
-- "detach on move" behavior, but the job clearly belongs to the only active recurring
-- series for that customer + service address. Safe when count of matching templates is 1.
-- Does not change dates, times, or line items — only the FK.

UPDATE ops_appointments a
SET recurring_template_id = t.id,
    updated_at = now()
FROM ops_recurring_templates t
WHERE a.recurring_template_id IS NULL
  AND t.is_active = true
  AND a.customer_id = t.customer_id
  AND a.service_address_id = t.service_address_id
  AND a.kind = 'service'
  AND NOT EXISTS (
    SELECT 1
    FROM ops_recurring_templates t2
    WHERE t2.customer_id = a.customer_id
      AND t2.service_address_id = a.service_address_id
      AND t2.is_active = true
      AND t2.id <> t.id
  );
