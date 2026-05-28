-- Echo V1: per-attempt audit trail for every social post delivery
CREATE TABLE IF NOT EXISTS social_post_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  draft_id UUID REFERENCES social_post_drafts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('google', 'facebook')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  reason TEXT,
  request_payload JSONB,
  response JSONB,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS social_post_log_unique_success
  ON social_post_log (job_id, channel)
  WHERE status = 'success' AND job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS social_post_log_attempted_at_idx ON social_post_log (attempted_at DESC);
CREATE INDEX IF NOT EXISTS social_post_log_job_id_idx ON social_post_log (job_id);
CREATE INDEX IF NOT EXISTS social_post_log_status_idx ON social_post_log (status);

ALTER TABLE social_post_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY social_post_log_admin_read ON social_post_log FOR SELECT USING (true);
CREATE POLICY social_post_log_admin_insert ON social_post_log FOR INSERT WITH CHECK (true);
