-- ============================================
-- Allow partners to insert leads for their own referrals
-- ============================================
-- When a partner submits a referral, a trigger (or app logic) may create
-- a row in leads. That insert runs as the partner, but RLS previously
-- only allowed admins to insert into leads, causing:
--   "new row violates row-level security policy for table \"leads\""
-- This policy allows partners to insert only rows where source = 'partner'
-- and partner_id matches their own partner record.
-- ============================================

CREATE POLICY "Partners can insert leads for own referrals"
  ON leads FOR INSERT
  WITH CHECK (
    source = 'partner'
    AND partner_id IN (
      SELECT id FROM partners WHERE user_id = auth.uid()
    )
  );
