-- Competitors table for deep competitor intelligence
-- Run this in Supabase SQL Editor

CREATE TABLE competitors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  website TEXT,
  phone TEXT,
  google_rating DECIMAL(2,1),
  google_review_count INTEGER,
  yelp_rating DECIMAL(2,1),
  yelp_review_count INTEGER,
  service_area TEXT,
  pricing_notes TEXT,
  services TEXT[],
  strengths TEXT,
  weaknesses TEXT,
  recent_promos TEXT,
  notes TEXT,
  last_researched TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with known competitors
INSERT INTO competitors (name, website, service_area) VALUES
  ('Oxi Fresh Carpet Cleaning', 'https://www.oxifresh.com', 'Colorado Springs, Monument, Denver Metro'),
  ('Stanley Steemer', 'https://www.stanleysteemer.com', 'Colorado Springs, Pueblo, Denver'),
  ('Zerorez', 'https://www.zerorez.com', 'Denver, Colorado Springs'),
  ('Chem-Dry', 'https://www.chemdry.com', 'Colorado Springs, Monument'),
  ('BISSELL Big Green', NULL, 'DIY Rental');

-- Enable RLS
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view competitors"
  ON competitors FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update competitors"
  ON competitors FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert competitors"
  ON competitors FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Service role full access"
  ON competitors FOR ALL
  TO service_role
  USING (true);

-- Index for quick lookups
CREATE INDEX idx_competitors_name ON competitors(name);
