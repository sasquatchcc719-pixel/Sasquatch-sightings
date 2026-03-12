ALTER TABLE ops_customers
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS business_name TEXT;

CREATE TABLE IF NOT EXISTS ops_calendar_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assigned_staff_user_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_kind TEXT NOT NULL DEFAULT 'block'
    CHECK (event_kind IN ('block')),
  title TEXT NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  is_all_day BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT ops_calendar_events_valid_dates CHECK (end_date >= start_date),
  CONSTRAINT ops_calendar_events_valid_window CHECK (
    (start_time IS NULL AND end_time IS NULL) OR
    (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  )
);

CREATE INDEX IF NOT EXISTS idx_ops_calendar_events_date_range
  ON ops_calendar_events(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_ops_calendar_events_staff
  ON ops_calendar_events(assigned_staff_user_id, start_date);

ALTER TABLE ops_calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ops users can read ops calendar events"
  ON ops_calendar_events FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'tech', 'marketing']));

CREATE POLICY "Owner and dispatcher can manage ops calendar events"
  ON ops_calendar_events FOR ALL
  USING (app_has_role(ARRAY['owner', 'dispatcher']))
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher']));
