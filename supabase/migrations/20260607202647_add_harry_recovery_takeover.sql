BEGIN;

ALTER TABLE harry_workflow_states
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS takeover_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS takeover_reason text,
  ADD COLUMN IF NOT EXISTS taken_over_at timestamptz;

ALTER TABLE harry_workflow_states
  DROP CONSTRAINT IF EXISTS harry_workflow_states_takeover_status_check;
ALTER TABLE harry_workflow_states
  ADD CONSTRAINT harry_workflow_states_takeover_status_check
  CHECK (takeover_status IN ('none', 'requested', 'acknowledged'));

ALTER TABLE harry_action_ledger
  ADD COLUMN IF NOT EXISTS attempt_kind text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS parent_tool_call_id text;

ALTER TABLE harry_action_ledger
  DROP CONSTRAINT IF EXISTS harry_action_ledger_attempt_kind_check;
ALTER TABLE harry_action_ledger
  ADD CONSTRAINT harry_action_ledger_attempt_kind_check
  CHECK (attempt_kind IN ('primary', 'recovery_lookup', 'recovery_retry', 'takeover'));

CREATE INDEX IF NOT EXISTS harry_workflow_states_takeover_idx
  ON harry_workflow_states (takeover_status, updated_at DESC)
  WHERE takeover_status <> 'none';

COMMENT ON COLUMN harry_workflow_states.consecutive_failures IS
  'Consecutive failed mutation attempts. Reset after a verified successful mutation.';
COMMENT ON COLUMN harry_workflow_states.recovery_attempts IS
  'Count of automatic bounded recovery attempts for the active workflow.';
COMMENT ON COLUMN harry_workflow_states.takeover_status IS
  'Whether deterministic recovery requested human takeover.';
COMMENT ON COLUMN harry_action_ledger.attempt_kind IS
  'Primary model action, automatic lookup, bounded retry, or takeover alert.';

COMMIT;
