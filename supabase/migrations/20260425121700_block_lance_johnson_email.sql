-- Put Lance Johnson on global do-not-send-email immediately.
-- This sets email_opt_out so lifecycle + drip email sends skip him.
UPDATE ops_customers
SET email_opt_out = true
WHERE full_name ILIKE 'Lance Johnson';

-- Remove any active drip enrollment for opted-out Lance records.
UPDATE drip_campaign_enrollments e
SET
  status = 'unsubscribed',
  updated_at = now()
WHERE e.status = 'active'
  AND e.customer_id IN (
    SELECT id
    FROM ops_customers
    WHERE full_name ILIKE 'Lance Johnson'
      AND email_opt_out = true
  );
