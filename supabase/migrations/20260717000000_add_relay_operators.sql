-- Relay operators: the people who answer customer texts from the Telegram
-- relay group (Charles, Tiffany, …). Maps a Telegram user id to a display name
-- so every relayed reply can be attributed to whoever sent it — both in the
-- topic ("✅ Sent · Tiffany") and in the invoice message log.
CREATE TABLE IF NOT EXISTS relay_operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service-role only (the relay webhook uses the admin client, which bypasses
-- RLS). Deny everything else by enabling RLS with no policies.
ALTER TABLE relay_operators ENABLE ROW LEVEL SECURITY;

-- Charles's Telegram user id is his personal chat id (8413118535). Tiffany's
-- row is added once her phone joins the group and we capture her id.
INSERT INTO relay_operators (telegram_user_id, display_name)
VALUES (8413118535, 'Charles')
ON CONFLICT (telegram_user_id) DO NOTHING;
