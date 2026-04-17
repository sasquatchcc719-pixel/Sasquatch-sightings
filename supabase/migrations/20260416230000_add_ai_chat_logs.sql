-- Universal logging for AI agent conversations (Harry, Scout, and future agents).
-- Every user/assistant/system/owner message gets one row in ai_chat_logs.
-- Every tool invocation gets one row in ai_tool_calls (linked by session_id).
--
-- Why a unified table (not per-agent)?
--   1. Single query surface for "show me every AI conversation"
--   2. Rate limiting can scan across agents for a given identity
--   3. One schema to evolve, not three

BEGIN;

CREATE TABLE IF NOT EXISTS ai_chat_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which agent produced/received this message
  agent            text NOT NULL CHECK (agent IN ('harry', 'scout', 'harry_owner')),
  channel          text NOT NULL CHECK (channel IN ('sms', 'web', 'admin')),

  -- Conversation grouping key:
  --   sms   -> conversations.id (uuid-as-text)
  --   web   -> web session uuid issued to the browser
  --   admin -> auth user id
  session_id       text NOT NULL,

  -- Who this message is from/to. Normalized forms:
  --   sms   -> E.164 phone number
  --   web   -> IP address (or anonymous session id)
  --   admin -> user email
  from_identity    text NOT NULL,

  -- Role of this message
  role             text NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'owner', 'tool')),
  content          text,

  -- Generation metadata (nullable — only present on assistant messages)
  model            text,
  tokens_prompt    integer,
  tokens_completion integer,
  latency_ms       integer,

  -- Free-form extras (referrer, user-agent, Twilio SID, partner context, etc.)
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_chat_logs_agent_created_idx
  ON ai_chat_logs (agent, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_chat_logs_session_created_idx
  ON ai_chat_logs (session_id, created_at);

CREATE INDEX IF NOT EXISTS ai_chat_logs_from_identity_created_idx
  ON ai_chat_logs (from_identity, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_chat_logs_channel_created_idx
  ON ai_chat_logs (channel, created_at DESC);

-- RLS: service role only. No anon/authenticated read paths — everything flows through admin API.
ALTER TABLE ai_chat_logs ENABLE ROW LEVEL SECURITY;


CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  agent            text NOT NULL CHECK (agent IN ('harry', 'scout', 'harry_owner')),
  session_id       text NOT NULL,

  -- Optional: which assistant message triggered this tool call
  assistant_message_id uuid REFERENCES ai_chat_logs (id) ON DELETE SET NULL,

  tool_name        text NOT NULL,
  args             jsonb NOT NULL DEFAULT '{}'::jsonb,
  result           jsonb,
  success          boolean NOT NULL,
  error            text,
  duration_ms      integer,

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_tool_calls_session_created_idx
  ON ai_tool_calls (session_id, created_at);

CREATE INDEX IF NOT EXISTS ai_tool_calls_agent_created_idx
  ON ai_tool_calls (agent, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_tool_calls_failures_idx
  ON ai_tool_calls (success, created_at DESC)
  WHERE success = false;

CREATE INDEX IF NOT EXISTS ai_tool_calls_tool_name_idx
  ON ai_tool_calls (tool_name, created_at DESC);

ALTER TABLE ai_tool_calls ENABLE ROW LEVEL SECURITY;

COMMIT;
