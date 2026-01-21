-- ============================================
-- PARTNER PORTAL - DATABASE MIGRATION
-- Date: 2026-01-21
-- Purpose: Add partners and referrals tables for Partner Referral Portal
-- ============================================

-- PARTNERS TABLE
CREATE TABLE partners (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  company_name TEXT NOT NULL,
  company_website TEXT,
  home_address TEXT NOT NULL,
  backlink_opted_in BOOLEAN DEFAULT false,
  backlink_verified BOOLEAN DEFAULT false,
  credit_balance DECIMAL(10, 2) DEFAULT 0,
  role TEXT DEFAULT 'partner' CHECK (role IN ('partner', 'admin')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- REFERRALS TABLE
CREATE TABLE referrals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id UUID REFERENCES partners(id) NOT NULL,
  client_name TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'booked', 'converted')),
  credit_amount DECIMAL(10, 2) DEFAULT 25,
  booked_via_link BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  converted_at TIMESTAMPTZ
);

-- INDEXES
CREATE INDEX idx_partners_user_id ON partners(user_id);
CREATE INDEX idx_partners_email ON partners(email);
CREATE INDEX idx_referrals_partner_id ON referrals(partner_id);
CREATE INDEX idx_referrals_status ON referrals(status);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- PARTNERS: Users can read their own partner record
CREATE POLICY "Partners can read own record"
  ON partners FOR SELECT
  USING (auth.uid() = user_id);

-- PARTNERS: Users can update their own partner record
CREATE POLICY "Partners can update own record"
  ON partners FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- PARTNERS: Anyone authenticated can insert (for registration)
CREATE POLICY "Authenticated users can create partner record"
  ON partners FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- PARTNERS: Admins can read all partners
CREATE POLICY "Admins can read all partners"
  ON partners FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM partners 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- PARTNERS: Admins can update all partners
CREATE POLICY "Admins can update all partners"
  ON partners FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM partners 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- REFERRALS: Partners can read their own referrals
CREATE POLICY "Partners can read own referrals"
  ON referrals FOR SELECT
  USING (
    partner_id IN (
      SELECT id FROM partners WHERE user_id = auth.uid()
    )
  );

-- REFERRALS: Partners can insert their own referrals
CREATE POLICY "Partners can create referrals"
  ON referrals FOR INSERT
  WITH CHECK (
    partner_id IN (
      SELECT id FROM partners WHERE user_id = auth.uid()
    )
  );

-- REFERRALS: Admins can read all referrals
CREATE POLICY "Admins can read all referrals"
  ON referrals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM partners 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- REFERRALS: Admins can update all referrals
CREATE POLICY "Admins can update all referrals"
  ON referrals FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM partners 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- REFERRALS: Admins can insert referrals for any partner
CREATE POLICY "Admins can create referrals for any partner"
  ON referrals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM partners 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE partners IS 'Partner (Realtor/Property Manager) accounts for referral program';
COMMENT ON TABLE referrals IS 'Customer referrals submitted by partners';

COMMENT ON COLUMN partners.backlink_opted_in IS 'Partner wants to add backlink for $25/referral (vs $20)';
COMMENT ON COLUMN partners.backlink_verified IS 'Admin verified the backlink exists';
COMMENT ON COLUMN partners.credit_balance IS 'Current credit balance in dollars';
COMMENT ON COLUMN partners.role IS 'User role: partner or admin';

COMMENT ON COLUMN referrals.status IS 'pending = submitted, booked = scheduled, converted = job completed';
COMMENT ON COLUMN referrals.booked_via_link IS 'True if partner used Book for Client button';
COMMENT ON COLUMN referrals.credit_amount IS 'Credit amount for this referral ($20 or $25)';
