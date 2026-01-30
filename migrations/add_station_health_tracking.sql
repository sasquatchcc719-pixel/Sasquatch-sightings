-- ============================================
-- STATION HEALTH TRACKING - DATABASE MIGRATION
-- Date: 2026-01-30
-- Purpose: Add Google review station tracking and health monitoring
-- ============================================

-- Add google_review_url to partners table for their review station
ALTER TABLE partners ADD COLUMN IF NOT EXISTS google_review_url TEXT;

-- Add coupon_code for partner-specific discount tracking
ALTER TABLE partners ADD COLUMN IF NOT EXISTS coupon_code TEXT UNIQUE;

-- Add metadata column to conversations for storing partner context
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Add last activity tracking for health monitoring
ALTER TABLE partners ADD COLUMN IF NOT EXISTS last_sasquatch_tap_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS last_review_tap_at TIMESTAMP WITH TIME ZONE;

-- Create review_station_taps table for tracking partner Google review station activity
CREATE TABLE IF NOT EXISTS review_station_taps (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  ip_address TEXT,
  user_agent TEXT,
  device_type TEXT DEFAULT 'mobile',
  location_city TEXT,
  location_region TEXT,
  location_country TEXT,
  tapped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on review_station_taps
ALTER TABLE review_station_taps ENABLE ROW LEVEL SECURITY;

-- Allow public to insert taps (anonymous tracking)
CREATE POLICY "Anyone can insert review taps"
  ON review_station_taps
  FOR INSERT
  WITH CHECK (true);

-- Only authenticated users can read
CREATE POLICY "Authenticated users can read review taps"
  ON review_station_taps
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Create index for partner lookups
CREATE INDEX IF NOT EXISTS idx_review_station_taps_partner_id ON review_station_taps(partner_id);
CREATE INDEX IF NOT EXISTS idx_review_station_taps_tapped_at ON review_station_taps(tapped_at DESC);

-- Create station_health_alerts table for tracking when alerts were sent
CREATE TABLE IF NOT EXISTS station_health_alerts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  station_type TEXT NOT NULL CHECK (station_type IN ('sasquatch', 'review')),
  alert_type TEXT NOT NULL CHECK (alert_type IN ('inactive', 'declining')),
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on station_health_alerts
ALTER TABLE station_health_alerts ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can read/write alerts
CREATE POLICY "Authenticated users can manage alerts"
  ON station_health_alerts
  FOR ALL
  USING (auth.role() = 'authenticated');

-- Index for partner alert lookups
CREATE INDEX IF NOT EXISTS idx_station_health_alerts_partner_id ON station_health_alerts(partner_id);
CREATE INDEX IF NOT EXISTS idx_station_health_alerts_sent_at ON station_health_alerts(sent_at DESC);

-- Comments
COMMENT ON COLUMN partners.google_review_url IS 'Google review URL for partner review station placard';
COMMENT ON COLUMN partners.last_sasquatch_tap_at IS 'Last tap on their Sasquatch lead gen station';
COMMENT ON COLUMN partners.last_review_tap_at IS 'Last tap on their Google review station';
COMMENT ON TABLE review_station_taps IS 'Tracks taps on partner Google review station placards';
COMMENT ON TABLE station_health_alerts IS 'Tracks health check alerts sent to partners about inactive stations';
