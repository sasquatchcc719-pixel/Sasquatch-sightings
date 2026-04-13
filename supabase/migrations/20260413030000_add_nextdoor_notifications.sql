CREATE TABLE IF NOT EXISTS nextdoor_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_message text NOT NULL,
  chat_url text,
  received_at timestamptz NOT NULL DEFAULT now(),
  viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE nextdoor_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin only" ON nextdoor_notifications
  FOR ALL USING (auth.role() = 'service_role');
