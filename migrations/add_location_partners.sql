-- ============================================
-- LOCATION PARTNERS - DATABASE MIGRATION
-- Date: 2026-01-30
-- Purpose: Extend partner system for NFC location-based partners
-- ============================================

-- Add partner_type to partners table
ALTER TABLE partners ADD COLUMN IF NOT EXISTS partner_type TEXT DEFAULT 'referral' CHECK (partner_type IN ('referral', 'location'));

-- Add card_id for location partners (their unique NFC card identifier)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS card_id TEXT UNIQUE;

-- Add location details for location partners
ALTER TABLE partners ADD COLUMN IF NOT EXISTS location_name TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS location_address TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS location_type TEXT;

-- Add reward tier tracking
ALTER TABLE partners ADD COLUMN IF NOT EXISTS reward_tier INTEGER DEFAULT 0;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS total_taps INTEGER DEFAULT 0;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS total_conversions INTEGER DEFAULT 0;

-- Index for card_id lookups
CREATE INDEX IF NOT EXISTS idx_partners_card_id ON partners(card_id) WHERE card_id IS NOT NULL;

-- Comments
COMMENT ON COLUMN partners.partner_type IS 'referral = traditional referral partners, location = NFC card location partners';
COMMENT ON COLUMN partners.card_id IS 'Unique card ID for location partners (e.g., barbershop-main)';
COMMENT ON COLUMN partners.location_name IS 'Business name for location partners';
COMMENT ON COLUMN partners.location_address IS 'Physical address where NFC card is mounted';
COMMENT ON COLUMN partners.location_type IS 'Type of location (barbershop, bar, gym, coffee_shop, etc)';
COMMENT ON COLUMN partners.reward_tier IS 'Current reward tier level (0-5)';
COMMENT ON COLUMN partners.total_taps IS 'Total NFC taps from this location partner';
COMMENT ON COLUMN partners.total_conversions IS 'Total conversions from this location partner';
