-- Second-pass backfill: catch LSA conversations whose message history does
-- NOT contain the "Replies to this number will be sent to the customer"
-- disclaimer, but DOES contain the LSA lead-prefix message or other
-- distinctive Google LSA boilerplate.
--
-- Google sends at least two different types of LSA signal SMS:
--   1. Lead-prefix: "You have received a new message from a customer via
--      Google Local Services Ads..."
--   2. Reply disclaimer: "Replies to this number will be sent to the
--      customer..."
-- The first pass only matched #2. This pass widens the net to catch #1,
-- plus any message containing "[Notes from LSA:" or "g.co/homeservices".

-- Step 1: signal-based detection using broader patterns.
UPDATE conversations AS c
SET source = 'Google LSA'
WHERE c.source NOT IN ('Google LSA', 'lsa')
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(c.messages) = 'array' THEN c.messages
        ELSE '[]'::jsonb
      END
    ) AS m
    WHERE (m->>'content') ~* '^\s*Replies to this number will be sent to the customer'
       OR (m->>'content') ~* '^\s*You have received a new message from a customer via Google Local Services Ads'
       OR (m->>'content') ILIKE '%[Notes from LSA:%'
       OR (m->>'content') ILIKE '%g.co/homeservices%'
  );

-- Step 2: phone-based propagation. Any phone we now know is an LSA relay
-- should have all of its 'inbound' conversations migrated to 'Google LSA'.
UPDATE conversations AS c
SET source = 'Google LSA'
WHERE c.source = 'inbound'
  AND c.phone_number IN (
    SELECT DISTINCT phone_number
    FROM conversations
    WHERE source = 'Google LSA'
      AND phone_number IS NOT NULL
  );

-- Step 3: ensure every LSA conversation keeps Harry auto-reply on.
-- (Redundant with the earlier migration, but cheap and idempotent.)
UPDATE conversations
SET ai_enabled = TRUE
WHERE source IN ('Google LSA', 'lsa')
  AND ai_enabled = FALSE;
