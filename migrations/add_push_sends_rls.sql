-- Enable RLS on push_sends so Supabase Security Advisor does not flag it.
-- Only admins (via partners.role = 'admin') can read; writes happen via service role in API.
ALTER TABLE push_sends ENABLE ROW LEVEL SECURITY;

-- Admins can read push send history (for dashboard)
CREATE POLICY "Admins can read push_sends"
  ON push_sends FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM partners
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- No INSERT/UPDATE/DELETE for anon/authenticated; API uses service role for writes
COMMENT ON TABLE push_sends IS 'One row per audience per send; stats from OneSignal View Message API. RLS: admin read only.';
