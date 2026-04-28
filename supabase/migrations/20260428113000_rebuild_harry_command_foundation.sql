CREATE TABLE IF NOT EXISTS harry_command_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id TEXT NOT NULL UNIQUE,
  telegram_user_id TEXT,
  last_customer_id UUID REFERENCES ops_customers(id) ON DELETE SET NULL,
  last_artifact_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS harry_command_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES harry_command_threads(id) ON DELETE CASCADE,
  telegram_message_id BIGINT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT harry_command_messages_role_check
    CHECK (role IN ('owner', 'assistant', 'tool', 'system'))
);

CREATE INDEX IF NOT EXISTS harry_command_messages_thread_created_idx
  ON harry_command_messages (thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS harry_command_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES harry_command_threads(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  customer_id UUID REFERENCES ops_customers(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES ops_appointments(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

ALTER TABLE harry_command_threads
  ADD CONSTRAINT harry_command_threads_last_artifact_fk
  FOREIGN KEY (last_artifact_id)
  REFERENCES harry_command_artifacts(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS harry_command_artifacts_thread_created_idx
  ON harry_command_artifacts (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS harry_command_artifacts_customer_idx
  ON harry_command_artifacts (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS harry_command_pending_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES harry_command_threads(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  action_payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  target_label TEXT,
  preview TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  telegram_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  error_message TEXT,
  CONSTRAINT harry_command_pending_actions_status_check
    CHECK (status IN ('pending', 'executed', 'cancelled', 'failed', 'expired'))
);

CREATE INDEX IF NOT EXISTS harry_command_pending_actions_status_expires_idx
  ON harry_command_pending_actions (status, expires_at);

CREATE INDEX IF NOT EXISTS harry_command_pending_actions_thread_idx
  ON harry_command_pending_actions (thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS harry_command_action_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES harry_command_threads(id) ON DELETE SET NULL,
  pending_action_id UUID REFERENCES harry_command_pending_actions(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  target_label TEXT,
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  telegram_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS harry_command_action_audit_thread_created_idx
  ON harry_command_action_audit (thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS harry_command_telegram_updates (
  update_id BIGINT PRIMARY KEY,
  thread_id UUID REFERENCES harry_command_threads(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE harry_command_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE harry_command_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE harry_command_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE harry_command_pending_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE harry_command_action_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE harry_command_telegram_updates ENABLE ROW LEVEL SECURITY;
