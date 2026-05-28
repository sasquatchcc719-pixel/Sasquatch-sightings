-- Echo V1: extend the existing social_post_drafts table to support Echo's flow
ALTER TABLE social_post_drafts ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE social_post_drafts ADD COLUMN IF NOT EXISTS style TEXT;
ALTER TABLE social_post_drafts ADD COLUMN IF NOT EXISTS skip_reason TEXT;

ALTER TABLE social_post_drafts DROP CONSTRAINT IF EXISTS social_post_drafts_post_type_check;
ALTER TABLE social_post_drafts ADD CONSTRAINT social_post_drafts_post_type_check
  CHECK (post_type IN (
    'educational','milestone','seasonal_tip','local_seo','behind_scenes',
    'recent_work','authority','offer','event','business_update'
  ));

ALTER TABLE social_post_drafts DROP CONSTRAINT IF EXISTS social_post_drafts_status_check;
ALTER TABLE social_post_drafts ADD CONSTRAINT social_post_drafts_status_check
  CHECK (status IN ('draft','approved','posted','rejected','failed','map_only','skipped'));

CREATE INDEX IF NOT EXISTS social_post_drafts_job_id_idx ON social_post_drafts (job_id);
CREATE INDEX IF NOT EXISTS social_post_drafts_status_idx ON social_post_drafts (status);
CREATE INDEX IF NOT EXISTS social_post_drafts_style_created_idx ON social_post_drafts (style, created_at DESC);
