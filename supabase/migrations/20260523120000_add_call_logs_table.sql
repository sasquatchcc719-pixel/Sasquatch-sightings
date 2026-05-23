CREATE TABLE call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sid TEXT UNIQUE NOT NULL,
  caller_phone TEXT,
  direction TEXT NOT NULL DEFAULT 'inbound',
  outcome TEXT NOT NULL DEFAULT 'inbound',
  -- outcomes: 'inbound' (pending), 'answered', 'voicemail', 'no-answer', 'blacklisted'
  duration_seconds INTEGER,
  recording_url TEXT,
  transcription TEXT,
  raw_dial_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX call_logs_created_at_idx ON call_logs (created_at DESC);
CREATE INDEX call_logs_caller_phone_idx ON call_logs (caller_phone);
CREATE INDEX call_logs_outcome_idx ON call_logs (outcome);

ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON call_logs USING (false);
