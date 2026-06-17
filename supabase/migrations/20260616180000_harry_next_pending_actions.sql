-- Harry (next) — approval queue.
--
-- Every action the new agent wants to take becomes a row here FIRST. Nothing
-- touches a customer or the ops tables until a row is approved. The recipient
-- phone is copied from the inbound conversation at creation time and is the
-- only number the executor will ever text — there is no path to send anywhere
-- else (the structural fix for the wrong-recipient class of bug).

create table if not exists harry_next_pending_actions (
  id uuid primary key default gen_random_uuid(),

  -- The inbound thread this action belongs to (optional), and the locked
  -- recipient phone — the recipient is always bound at creation time.
  conversation_id uuid,
  recipient_phone text not null,

  -- The validated, typed intent the model proposed (see src/lib/harry-next/intents.ts).
  intent jsonb not null,

  -- What the approver sees in Telegram: a human action summary and the exact
  -- customer reply (numbers already injected by deterministic code).
  action_summary text not null,
  proposed_reply text not null,

  -- pending -> approved | rejected ; approved -> executed | failed ; or expired.
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'executed', 'failed', 'expired')),

  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  executed_at timestamptz,
  execution_error text,

  -- For editing/answering the approval card in place.
  telegram_message_id text
);

create index if not exists harry_next_pending_actions_status_idx
  on harry_next_pending_actions (status, created_at);

create index if not exists harry_next_pending_actions_conversation_idx
  on harry_next_pending_actions (conversation_id, created_at desc);

-- Service-role only; the agent runs server-side with the admin client.
alter table harry_next_pending_actions enable row level security;
