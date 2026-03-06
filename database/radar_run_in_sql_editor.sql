-- ============================================
-- SASQUATCH RADAR - Run this in Supabase SQL Editor
-- Copy the entire file and paste into: SQL Editor > New query > Run
-- ============================================

-- RADAR KEYWORDS (search terms we track)
CREATE TABLE radar_keywords (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword TEXT NOT NULL,
  location TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_radar_keywords_active ON radar_keywords(active) WHERE active = true;

-- RADAR DOMAINS (our site + competitors)
CREATE TABLE radar_domains (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  display_name TEXT,
  is_my_domain BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_radar_domains_domain ON radar_domains(domain);

-- RADAR RANKINGS (time-series: keyword_id, domain_id, position, created_at)
CREATE TABLE radar_rankings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword_id UUID NOT NULL REFERENCES radar_keywords(id) ON DELETE CASCADE,
  domain_id UUID NOT NULL REFERENCES radar_domains(id) ON DELETE CASCADE,
  rank_position INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_radar_rankings_keyword_created ON radar_rankings(keyword_id, created_at DESC);
CREATE INDEX idx_radar_rankings_domain_created ON radar_rankings(domain_id, created_at DESC);
CREATE INDEX idx_radar_rankings_created ON radar_rankings(created_at DESC);

-- ============================================
-- ROW LEVEL SECURITY (authenticated users only)
-- ============================================

ALTER TABLE radar_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE radar_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE radar_rankings ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read and manage keywords
CREATE POLICY "Authenticated can manage radar_keywords"
  ON radar_keywords FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Authenticated users can read and manage domains
CREATE POLICY "Authenticated can manage radar_domains"
  ON radar_domains FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Authenticated users can read rankings (inserts done by cron via service role)
CREATE POLICY "Authenticated can read radar_rankings"
  ON radar_rankings FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated can insert radar_rankings"
  ON radar_rankings FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
