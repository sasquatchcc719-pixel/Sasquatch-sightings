-- Google LSA conversations must be 100% automated. Heal any existing LSA
-- conversation that was silenced (ai_enabled=false) — this could happen if a
-- relay phone number ever collided with an ops_customer row under the old
-- silencing rule that didn't exempt LSA.

UPDATE conversations
SET ai_enabled = TRUE
WHERE source IN ('Google LSA', 'lsa')
  AND ai_enabled = FALSE;
