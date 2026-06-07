BEGIN;

CREATE TABLE IF NOT EXISTS harry_workflow_states (
  conversation_id uuid PRIMARY KEY
    REFERENCES conversations(id) ON DELETE CASCADE,
  intent text NOT NULL DEFAULT 'general',
  phase text NOT NULL DEFAULT 'idle',
  last_customer_message text,
  last_assistant_message text,
  last_action_name text,
  last_action_status text
    CHECK (last_action_status IS NULL OR last_action_status IN ('succeeded', 'failed')),
  last_action_error text,
  action_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  turn_count integer NOT NULL DEFAULT 0,
  last_customer_at timestamptz,
  last_assistant_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS harry_workflow_states_phase_idx
  ON harry_workflow_states (phase, updated_at DESC);

CREATE TABLE IF NOT EXISTS harry_action_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL
    REFERENCES conversations(id) ON DELETE CASCADE,
  tool_call_id text,
  tool_name text NOT NULL,
  mutates_customer_data boolean NOT NULL DEFAULT false,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  success boolean NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS harry_action_ledger_tool_call_id_idx
  ON harry_action_ledger (tool_call_id);

CREATE INDEX IF NOT EXISTS harry_action_ledger_conversation_created_idx
  ON harry_action_ledger (conversation_id, created_at DESC);

ALTER TABLE harry_workflow_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE harry_action_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE harry_workflow_states FROM anon, authenticated;
REVOKE ALL ON TABLE harry_action_ledger FROM anon, authenticated;
GRANT ALL ON TABLE harry_workflow_states TO service_role;
GRANT ALL ON TABLE harry_action_ledger TO service_role;

COMMENT ON TABLE harry_workflow_states IS
  'Durable, compact workflow state for Harry SMS conversations.';
COMMENT ON TABLE harry_action_ledger IS
  'Authoritative record of Harry tool attempts and outcomes.';

COMMIT;
