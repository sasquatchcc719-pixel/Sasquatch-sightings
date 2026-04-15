-- Migration: add ops_calendar_events table
-- Run this in the Supabase SQL editor to fix the "Failed to load schedule data" 500 error.

CREATE TABLE IF NOT EXISTS ops_calendar_events (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  title                 TEXT        NOT NULL,
  description           TEXT,
  start_date            DATE        NOT NULL,
  end_date              DATE        NOT NULL,
  start_time            TIME,
  end_time              TIME,
  is_all_day            BOOLEAN     NOT NULL DEFAULT TRUE,
  assigned_staff_user_id UUID       REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by            UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ops_calendar_events_dates_check CHECK (end_date >= start_date),
  CONSTRAINT ops_calendar_events_times_check CHECK (
    (start_time IS NULL AND end_time IS NULL) OR
    (start_time IS NOT NULL AND end_time IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ops_calendar_events_date_range
  ON ops_calendar_events (start_date, end_date);

-- Row Level Security (match the pattern used by other ops tables)
ALTER TABLE ops_calendar_events ENABLE ROW LEVEL SECURITY;

-- Admins, owners, dispatchers, and techs can read events
CREATE POLICY "ops_calendar_events_read" ON ops_calendar_events
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher', 'tech', 'marketing')
    )
  );

-- Only admins, owners, and dispatchers can write events
CREATE POLICY "ops_calendar_events_write" ON ops_calendar_events
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher')
    )
  );
