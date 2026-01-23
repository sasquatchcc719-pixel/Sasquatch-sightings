-- ============================================
-- LEAD TRACKER - DATABASE MIGRATION
-- Date: 2026-01-22
-- Purpose: Central leads table for unified lead tracking
-- ============================================

-- LEADS TABLE (Central lead tracking from all sources)
CREATE TABLE leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('contest', 'partner', 'missed_call', 'website')),
  name TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  location TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'quoted', 'scheduled', 'won', 'lost')),
  notes TEXT,
  partner_id UUID REFERENCES partners(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  contacted_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  won_at TIMESTAMPTZ
);

-- INDEXES (Performance for dashboard queries)
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_source ON leads(source);
CREATE INDEX idx_leads_created ON leads(created_at DESC);
CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_partner ON leads(partner_id) WHERE partner_id IS NOT NULL;

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- LEADS: Only admins can read all leads
CREATE POLICY "Admins can read all leads"
  ON leads FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM partners 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- LEADS: Only admins can insert leads
CREATE POLICY "Admins can insert leads"
  ON leads FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM partners 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- LEADS: Only admins can update leads
CREATE POLICY "Admins can update leads"
  ON leads FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM partners 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- LEADS: Only admins can delete leads
CREATE POLICY "Admins can delete leads"
  ON leads FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM partners 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE leads IS 'Central lead tracking table - all sources flow here via Zapier';
COMMENT ON COLUMN leads.source IS 'Where lead came from: contest, partner, missed_call, website';
COMMENT ON COLUMN leads.phone IS 'Normalized phone number - required for all leads';
COMMENT ON COLUMN leads.partner_id IS 'Link to referring partner (only for source=partner)';
COMMENT ON COLUMN leads.status IS 'Lead status: new → contacted → quoted → scheduled → won/lost';
COMMENT ON COLUMN leads.contacted_at IS 'When you first contacted this lead';
COMMENT ON COLUMN leads.scheduled_at IS 'When job was scheduled';
COMMENT ON COLUMN leads.won_at IS 'When job was completed (lead converted to customer)';
