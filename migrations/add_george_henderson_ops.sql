-- George Henderson ops agent: action confirmations, audit trail, and call routing controls

ALTER TABLE phone_settings
  ADD COLUMN IF NOT EXISTS twilio_primary_forward_number text NOT NULL DEFAULT '+17206447577',
  ADD COLUMN IF NOT EXISTS twilio_failover_forward_number text NOT NULL DEFAULT '+17206447577',
  ADD COLUMN IF NOT EXISTS ivr_schedule_timeout_seconds integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS ivr_technical_timeout_seconds integer NOT NULL DEFAULT 20;

CREATE TABLE IF NOT EXISTS george_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  confirmation_token text UNIQUE NOT NULL,
  actor_user_id uuid,
  actor_email text,
  actor_role text,
  action_name text NOT NULL,
  action_payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS george_pending_actions_expires_idx
  ON george_pending_actions (expires_at);

CREATE TABLE IF NOT EXISTS george_action_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_email text,
  actor_role text,
  action_name text NOT NULL,
  status text NOT NULL DEFAULT 'executed',
  target text,
  reason text,
  before_state jsonb,
  after_state jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS george_action_audit_created_idx
  ON george_action_audit (created_at DESC);
