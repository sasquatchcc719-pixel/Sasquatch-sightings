-- ============================================
-- HIRING READINESS - DATABASE MIGRATION
-- Date: 2026-01-29
-- Purpose: Track weekly revenue for hiring readiness indicator
-- ============================================

-- Weekly Revenue History Table (for tracking hiring readiness)
CREATE TABLE IF NOT EXISTS weekly_revenue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  total_revenue DECIMAL(10,2) DEFAULT 0,
  total_jobs INTEGER DEFAULT 0,
  total_hours DECIMAL(6,2) DEFAULT 0,
  meets_threshold BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, week_start)
);

-- Add hiring settings to settings table
ALTER TABLE settings ADD COLUMN IF NOT EXISTS hiring_threshold DECIMAL(10,2) DEFAULT 4000;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS hiring_consecutive_weeks INTEGER DEFAULT 4;

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_weekly_revenue_user_week ON weekly_revenue(user_id, week_start DESC);

-- Enable RLS
ALTER TABLE weekly_revenue ENABLE ROW LEVEL SECURITY;

-- Users can read their own weekly revenue
CREATE POLICY "Users can read own weekly revenue"
  ON weekly_revenue FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own weekly revenue
CREATE POLICY "Users can insert own weekly revenue"
  ON weekly_revenue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own weekly revenue
CREATE POLICY "Users can update own weekly revenue"
  ON weekly_revenue FOR UPDATE
  USING (auth.uid() = user_id);

COMMENT ON TABLE weekly_revenue IS 'Tracks weekly revenue history for hiring readiness calculation';
COMMENT ON COLUMN weekly_revenue.meets_threshold IS 'True if week revenue >= hiring_threshold';
COMMENT ON COLUMN settings.hiring_threshold IS 'Weekly revenue threshold to trigger hiring readiness ($4000 default)';
COMMENT ON COLUMN settings.hiring_consecutive_weeks IS 'Number of consecutive weeks needed (4 default)';
