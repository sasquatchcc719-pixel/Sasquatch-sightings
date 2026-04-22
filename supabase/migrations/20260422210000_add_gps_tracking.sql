-- Phase 2: GPS tracking tables + arrived_at on ops_appointments
-- All GPS data is shadow-mode only in v1: existing financials are untouched.

-- ─────────────────────────────────────────────────
-- gps_shifts: one row per clock-in session
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gps_shifts (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at       TIMESTAMPTZ,
  total_distance_m DOUBLE PRECISION DEFAULT 0,
  status         TEXT        NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'completed', 'abandoned')),
  device_info    JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gps_shifts_user_started
  ON gps_shifts (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_gps_shifts_status
  ON gps_shifts (status) WHERE status = 'active';

-- ─────────────────────────────────────────────────
-- gps_points: raw breadcrumbs
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gps_points (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  shift_id       UUID        REFERENCES gps_shifts(id) ON DELETE CASCADE NOT NULL,
  captured_at    TIMESTAMPTZ NOT NULL,
  lat            DOUBLE PRECISION NOT NULL,
  lng            DOUBLE PRECISION NOT NULL,
  accuracy_m     DOUBLE PRECISION,
  speed_mps      DOUBLE PRECISION,
  heading_deg    DOUBLE PRECISION,
  battery_pct    INTEGER,
  appointment_id UUID        REFERENCES ops_appointments(id) ON DELETE SET NULL,
  segment_type   TEXT        NOT NULL DEFAULT 'unknown'
                   CHECK (segment_type IN ('travel', 'on_site', 'idle', 'unknown'))
);

CREATE INDEX IF NOT EXISTS idx_gps_points_shift_captured
  ON gps_points (shift_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_gps_points_appointment
  ON gps_points (appointment_id) WHERE appointment_id IS NOT NULL;

-- ─────────────────────────────────────────────────
-- gps_appointment_visits: rolled-up per appointment per shift
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gps_appointment_visits (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  shift_id           UUID        REFERENCES gps_shifts(id) ON DELETE CASCADE NOT NULL,
  appointment_id     UUID        REFERENCES ops_appointments(id) ON DELETE CASCADE NOT NULL,
  arrived_at         TIMESTAMPTZ,
  departed_at        TIMESTAMPTZ,
  on_site_minutes    INTEGER     DEFAULT 0,
  travel_in_minutes  INTEGER     DEFAULT 0,
  max_accuracy_m     DOUBLE PRECISION,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shift_id, appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_gps_visits_appointment
  ON gps_appointment_visits (appointment_id);

-- ─────────────────────────────────────────────────
-- arrived_at on ops_appointments (shadow mode)
-- v1: DOES NOT affect billing or revenue_entries.
-- Used only for timesheet reporting comparison.
-- ─────────────────────────────────────────────────
ALTER TABLE ops_appointments
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────
-- gps_consent: store per-user GPS consent timestamp
-- Added to staff_users to keep consent auditable.
-- ─────────────────────────────────────────────────
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS gps_consent_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────
ALTER TABLE gps_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_appointment_visits ENABLE ROW LEVEL SECURITY;

-- gps_shifts policies
CREATE POLICY "gps_shifts_own_read"
  ON gps_shifts FOR SELECT
  USING (auth.uid() = user_id OR app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "gps_shifts_own_insert"
  ON gps_shifts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "gps_shifts_own_update"
  ON gps_shifts FOR UPDATE
  USING (auth.uid() = user_id OR app_has_role(ARRAY['owner', 'dispatcher']));

-- gps_points policies
CREATE POLICY "gps_points_own_read"
  ON gps_points FOR SELECT
  USING (
    shift_id IN (SELECT id FROM gps_shifts WHERE user_id = auth.uid())
    OR app_has_role(ARRAY['owner', 'dispatcher'])
  );

CREATE POLICY "gps_points_own_insert"
  ON gps_points FOR INSERT
  WITH CHECK (
    shift_id IN (SELECT id FROM gps_shifts WHERE user_id = auth.uid())
  );

-- gps_appointment_visits policies
CREATE POLICY "gps_visits_own_read"
  ON gps_appointment_visits FOR SELECT
  USING (
    shift_id IN (SELECT id FROM gps_shifts WHERE user_id = auth.uid())
    OR app_has_role(ARRAY['owner', 'dispatcher'])
  );

CREATE POLICY "gps_visits_own_write"
  ON gps_appointment_visits FOR ALL
  USING (
    shift_id IN (SELECT id FROM gps_shifts WHERE user_id = auth.uid())
    OR app_has_role(ARRAY['owner', 'dispatcher'])
  );
