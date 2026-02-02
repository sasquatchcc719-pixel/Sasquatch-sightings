-- Harry the Sasquatch Analyst - Market Intelligence Tables
-- Run this in Supabase SQL Editor

-- Targets for market intel scraping (user configures these)
CREATE TABLE market_intel_targets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL,           -- competitor, keyword, location, subreddit
  value TEXT NOT NULL,          -- "Oxi Fresh", "carpet cleaning monument", etc.
  source TEXT NOT NULL,         -- google, yelp, gbp, reddit, website
  url TEXT,                     -- direct URL if applicable
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Market intel gathered by SuperAGI (bot fills this)
CREATE TABLE market_intel (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  target_id UUID REFERENCES market_intel_targets(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  competitor TEXT,              -- if about a specific competitor
  content TEXT NOT NULL,        -- what was found
  url TEXT,
  sentiment TEXT,               -- positive, negative, neutral (optional)
  captured_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for faster queries
CREATE INDEX idx_market_intel_captured ON market_intel(captured_at DESC);
CREATE INDEX idx_market_intel_source ON market_intel(source);
CREATE INDEX idx_market_intel_target ON market_intel(target_id);
CREATE INDEX idx_market_intel_targets_active ON market_intel_targets(is_active);

-- Enable RLS
ALTER TABLE market_intel_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_intel ENABLE ROW LEVEL SECURITY;

-- RLS Policies - only authenticated users can access
CREATE POLICY "Authenticated users can view market intel targets"
  ON market_intel_targets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert market intel targets"
  ON market_intel_targets FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update market intel targets"
  ON market_intel_targets FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete market intel targets"
  ON market_intel_targets FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view market intel"
  ON market_intel FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert market intel"
  ON market_intel FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Service role can manage all market intel"
  ON market_intel FOR ALL
  TO service_role
  USING (true);

CREATE POLICY "Service role can manage all market intel targets"
  ON market_intel_targets FOR ALL
  TO service_role
  USING (true);
