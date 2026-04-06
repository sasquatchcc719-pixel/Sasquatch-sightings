-- Add social_posted_at to jobs table
-- Tracks when a job was sent to the social/GBP feed so it never gets posted twice
-- and so we can enforce a weekly posting cap

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS social_posted_at TIMESTAMPTZ NULL;

-- Index for the feed query (unposted published jobs)
CREATE INDEX IF NOT EXISTS idx_jobs_social_feed
  ON jobs (status, social_posted_at, published_at DESC)
  WHERE status = 'published';
