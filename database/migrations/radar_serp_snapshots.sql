-- Who's actually ranking #1–10 (full SERP from each scan). Run in Supabase SQL Editor.

CREATE TABLE radar_serp_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword_id UUID NOT NULL REFERENCES radar_keywords(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  domain TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_radar_serp_snapshots_keyword ON radar_serp_snapshots(keyword_id);
CREATE INDEX idx_radar_serp_snapshots_keyword_created ON radar_serp_snapshots(keyword_id, created_at DESC);

ALTER TABLE radar_serp_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read radar_serp_snapshots"
  ON radar_serp_snapshots FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated can insert radar_serp_snapshots"
  ON radar_serp_snapshots FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated can delete radar_serp_snapshots"
  ON radar_serp_snapshots FOR DELETE
  USING (auth.role() = 'authenticated');
