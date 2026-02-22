-- Push notification send history (per audience) for dashboard and trends
CREATE TABLE IF NOT EXISTS push_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  title TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered INTEGER,
  received INTEGER,
  opened INTEGER,
  failed INTEGER,
  errored INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_sends_sent_at ON push_sends (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_sends_audience ON push_sends (audience);

COMMENT ON TABLE push_sends IS 'One row per audience per send; stats from OneSignal View Message API';
