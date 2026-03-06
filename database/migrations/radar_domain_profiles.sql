-- Competitor Intelligence Dossier: profile per radar_domain (1:1).
-- Run in Supabase SQL Editor.

CREATE TABLE radar_domain_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  domain_id UUID NOT NULL UNIQUE REFERENCES radar_domains(id) ON DELETE CASCADE,
  threat_level TEXT,
  business_model TEXT,
  primary_strength TEXT,
  core_weakness TEXT,
  sasquatch_counter_attack TEXT,
  threat_archetype TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_radar_domain_profiles_domain_id ON radar_domain_profiles(domain_id);

ALTER TABLE radar_domain_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read radar_domain_profiles"
  ON radar_domain_profiles FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated can insert radar_domain_profiles"
  ON radar_domain_profiles FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated can update radar_domain_profiles"
  ON radar_domain_profiles FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
