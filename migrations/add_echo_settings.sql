-- Echo V1: single-row config table for runtime controls
CREATE TABLE IF NOT EXISTS echo_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  auto_post BOOLEAN NOT NULL DEFAULT FALSE,
  google_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  facebook_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  weekly_cap INTEGER NOT NULL DEFAULT 3 CHECK (weekly_cap >= 0 AND weekly_cap <= 20),
  skip_repeat_days INTEGER NOT NULL DEFAULT 3 CHECK (skip_repeat_days >= 0 AND skip_repeat_days <= 30),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO echo_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE echo_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY echo_settings_admin_read ON echo_settings FOR SELECT USING (true);
CREATE POLICY echo_settings_admin_write ON echo_settings FOR UPDATE USING (true) WITH CHECK (true);
