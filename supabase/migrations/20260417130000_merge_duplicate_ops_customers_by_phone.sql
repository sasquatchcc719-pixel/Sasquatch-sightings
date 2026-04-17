-- One-time merge: duplicate ops_customers that share the same US phone (last 10 digits).
-- Keeps the earliest row per phone (created_at, then id). Repoints FKs, copies missing
-- QuickBooks / email / notes onto the survivor, normalizes phone to +1XXXXXXXXXX, deletes dup rows.

CREATE TEMP TABLE _dup_customer_merge (
  dup_id UUID PRIMARY KEY,
  canonical_id UUID NOT NULL
) ON COMMIT DROP;

INSERT INTO _dup_customer_merge (dup_id, canonical_id)
WITH phone_groups AS (
  SELECT
    id,
    right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) AS d10,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM ops_customers
  WHERE coalesce(phone, '') <> ''
    AND length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10
),
keepers AS (
  SELECT id AS canonical_id, d10
  FROM phone_groups
  WHERE rn = 1
)
SELECT g.id AS dup_id, k.canonical_id
FROM phone_groups g
JOIN keepers k ON k.d10 = g.d10
WHERE g.rn > 1;

-- Fold useful fields from duplicates onto the canonical row (QuickBooks id, email, notes).
UPDATE ops_customers canon
SET
  quickbooks_customer_id = COALESCE(
    canon.quickbooks_customer_id,
    (
      SELECT d.quickbooks_customer_id
      FROM ops_customers d
      JOIN _dup_customer_merge m ON d.id = m.dup_id
      WHERE m.canonical_id = canon.id
        AND d.quickbooks_customer_id IS NOT NULL
        AND btrim(d.quickbooks_customer_id) <> ''
      ORDER BY d.created_at DESC
      LIMIT 1
    )
  ),
  email = CASE
    WHEN canon.email IS NOT NULL AND btrim(canon.email) <> '' THEN canon.email
    ELSE (
      SELECT d.email
      FROM ops_customers d
      JOIN _dup_customer_merge m ON d.id = m.dup_id
      WHERE m.canonical_id = canon.id
        AND d.email IS NOT NULL
        AND btrim(d.email) <> ''
      ORDER BY d.created_at DESC
      LIMIT 1
    )
  END,
  notes = CASE
    WHEN canon.notes IS NOT NULL AND btrim(canon.notes) <> '' THEN canon.notes
    ELSE (
      SELECT d.notes
      FROM ops_customers d
      JOIN _dup_customer_merge m ON d.id = m.dup_id
      WHERE m.canonical_id = canon.id
        AND d.notes IS NOT NULL
        AND btrim(d.notes) <> ''
      ORDER BY d.created_at DESC
      LIMIT 1
    )
  END,
  updated_at = now()
WHERE canon.id IN (SELECT DISTINCT canonical_id FROM _dup_customer_merge);

UPDATE ops_appointments o
SET customer_id = m.canonical_id,
    updated_at = now()
FROM _dup_customer_merge m
WHERE o.customer_id = m.dup_id;

UPDATE ops_appointments o
SET batch_billing_customer_id = m.canonical_id,
    updated_at = now()
FROM _dup_customer_merge m
WHERE o.batch_billing_customer_id = m.dup_id;

UPDATE ops_service_addresses a
SET customer_id = m.canonical_id,
    updated_at = now()
FROM _dup_customer_merge m
WHERE a.customer_id = m.dup_id;

UPDATE ops_communication_queue q
SET customer_id = m.canonical_id,
    updated_at = now()
FROM _dup_customer_merge m
WHERE q.customer_id = m.dup_id;

UPDATE drip_campaign_enrollments e
SET customer_id = m.canonical_id,
    updated_at = now()
FROM _dup_customer_merge m
WHERE e.customer_id = m.dup_id;

UPDATE ops_recurring_templates t
SET customer_id = m.canonical_id,
    updated_at = now()
FROM _dup_customer_merge m
WHERE t.customer_id = m.dup_id;

UPDATE ops_batch_invoices b
SET customer_id = m.canonical_id,
    updated_at = now()
FROM _dup_customer_merge m
WHERE b.customer_id = m.dup_id;

UPDATE ops_email_log l
SET customer_id = m.canonical_id
FROM _dup_customer_merge m
WHERE l.customer_id = m.dup_id;

-- E.164 for merged survivors (US10-digit tail).
UPDATE ops_customers c
SET
  phone = '+1'
    || right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10),
  updated_at = now()
WHERE c.id IN (SELECT DISTINCT canonical_id FROM _dup_customer_merge)
  AND length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 10;

DELETE FROM ops_customers c
WHERE c.id IN (SELECT dup_id FROM _dup_customer_merge);
