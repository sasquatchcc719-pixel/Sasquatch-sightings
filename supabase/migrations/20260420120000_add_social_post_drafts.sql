-- AI-generated social post drafts awaiting review and approval
CREATE TABLE IF NOT EXISTS social_post_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_type TEXT NOT NULL CHECK (post_type IN ('educational','milestone','seasonal_tip','local_seo','behind_scenes')),
  title TEXT,
  body TEXT NOT NULL,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','posted','rejected')),
  context_data JSONB,   -- what triggered it: city, service, milestone count, etc.
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_post_drafts_status ON social_post_drafts(status);
CREATE INDEX IF NOT EXISTS idx_social_post_drafts_created ON social_post_drafts(created_at DESC);
