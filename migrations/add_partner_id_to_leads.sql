-- ============================================
-- Add partner_id to leads table for NFC attribution
-- Date: 2026-01-30
-- Purpose: Track which leads came from location partners
-- ============================================

-- Add partner_id column to leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id);

-- Index for quick partner lookups
CREATE INDEX IF NOT EXISTS idx_leads_partner_id ON leads(partner_id) WHERE partner_id IS NOT NULL;

-- Comment
COMMENT ON COLUMN leads.partner_id IS 'Location partner ID if lead came from an NFC card';
