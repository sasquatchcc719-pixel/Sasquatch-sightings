BEGIN;

ALTER TABLE harry_workflow_states
  ADD COLUMN IF NOT EXISTS collected_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS missing_fields text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS server_refs jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN harry_workflow_states.collected_fields IS
  'Structured customer, service, date, and time details collected for the active workflow.';
COMMENT ON COLUMN harry_workflow_states.missing_fields IS
  'Deterministically calculated fields still required before the next workflow action.';
COMMENT ON COLUMN harry_workflow_states.server_refs IS
  'Server-only appointment UUIDs, service IDs, and signed slot tokens. Never inject raw values into the model prompt.';

COMMIT;
