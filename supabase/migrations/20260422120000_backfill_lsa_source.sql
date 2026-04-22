-- Backfill: reclassify historical conversations that came through Google LSA
-- but were silently stored as source='inbound'. Google LSA sends every inbound
-- as two SMS — the customer's real message, then a boilerplate disclaimer
-- ("Replies to this number will be sent to the customer..."). That disclaimer
-- in a conversation's message history is a definitive signal that the phone
-- number is an LSA relay.
--
-- Two-step backfill:
--   1. Mark any conversation whose message history contains the disclaimer as
--      'Google LSA'.
--   2. Mark any other conversation sharing a phone number with an LSA
--      conversation as 'Google LSA' too (covers leftover 'inbound' rows for
--      the same relay phone that happened to not include the disclaimer text
--      themselves, e.g. subsequent customer replies).

-- Step 1: disclaimer-based detection.
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
  );

-- Step 2: phone-based propagation. Any phone that we now know is an LSA relay
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
