-- ============================================
-- OUTBOUND REFERRALS - DATABASE MIGRATION
-- Date: 2026-01-29
-- Purpose: Add outbound_referrals table for sending work TO partners
-- ============================================

-- OUTBOUND REFERRALS TABLE (Work sent FROM Sasquatch TO partners)
CREATE TABLE outbound_referrals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id UUID REFERENCES partners(id) NOT NULL,
  client_name TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  client_email TEXT,
  description TEXT NOT NULL,
  notes TEXT,
  referral_fee DECIMAL(10, 2) DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'completed', 'declined')),
  created_at TIMESTAMPTZ DEFAULT now(),
  viewed_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Add referral_balance_owed to partners table (what they owe you)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS referral_balance_owed DECIMAL(10, 2) DEFAULT 0;

-- INDEXES
CREATE INDEX idx_outbound_referrals_partner_id ON outbound_referrals(partner_id);
CREATE INDEX idx_outbound_referrals_status ON outbound_referrals(status);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS
ALTER TABLE outbound_referrals ENABLE ROW LEVEL SECURITY;

-- OUTBOUND REFERRALS: Partners can read their own outbound referrals
CREATE POLICY "Partners can read own outbound referrals"
  ON outbound_referrals FOR SELECT
  USING (
    partner_id IN (
      SELECT id FROM partners WHERE user_id = auth.uid()
    )
  );

-- OUTBOUND REFERRALS: Partners can update their own outbound referrals (to accept/decline)
CREATE POLICY "Partners can update own outbound referrals"
  ON outbound_referrals FOR UPDATE
  USING (
    partner_id IN (
      SELECT id FROM partners WHERE user_id = auth.uid()
    )
  );

-- OUTBOUND REFERRALS: Admins can read all outbound referrals
CREATE POLICY "Admins can read all outbound referrals"
  ON outbound_referrals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM partners 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- OUTBOUND REFERRALS: Admins can insert outbound referrals
CREATE POLICY "Admins can create outbound referrals"
  ON outbound_referrals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM partners 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- OUTBOUND REFERRALS: Admins can update all outbound referrals
CREATE POLICY "Admins can update all outbound referrals"
  ON outbound_referrals FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM partners 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- OUTBOUND REFERRALS: Admins can delete outbound referrals
CREATE POLICY "Admins can delete outbound referrals"
  ON outbound_referrals FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM partners 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE outbound_referrals IS 'Work referrals sent FROM Sasquatch TO partners';
COMMENT ON COLUMN outbound_referrals.description IS 'Free-form description of the work (e.g., Carpet Stretching in Monument)';
COMMENT ON COLUMN outbound_referrals.referral_fee IS 'Fee the partner owes Sasquatch for this referral ($0 or more)';
COMMENT ON COLUMN outbound_referrals.status IS 'pending = sent awaiting response, accepted = partner took the job, completed = job done, declined = partner declined';
COMMENT ON COLUMN partners.referral_balance_owed IS 'Running total of referral fees partner owes Sasquatch';
