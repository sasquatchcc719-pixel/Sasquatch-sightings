-- Persistent, owner-bound MCP Events subscriptions and an inbound-SMS outbox.
-- This migration does not grant an MCP scope, send a webhook, or change any
-- customer-facing messaging behavior.

create table public.mcp_event_subscriptions (
  id text primary key check (id ~ '^sub_[0-9a-f]{32}$'),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null check (event_name = 'conversation.message.received'),
  arguments jsonb not null default '{}'::jsonb,
  arguments_hash text not null check (arguments_hash ~ '^[0-9a-f]{64}$'),
  callback_url text not null check (callback_url ~ '^https://'),
  callback_secret text not null check (callback_secret ~ '^whsec_'),
  previous_callback_secret text check (
    previous_callback_secret is null or previous_callback_secret ~ '^whsec_'
  ),
  secret_rotated_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'expired')),
  verified_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, event_name, arguments_hash, callback_url)
);

create index mcp_event_subscriptions_active_idx
  on public.mcp_event_subscriptions (status, expires_at);

create table public.mcp_inbound_event_ledger (
  message_sid text primary key check (message_sid ~ '^SM[0-9A-Za-z]{8,64}$'),
  status text not null default 'processing'
    check (status in ('processing', 'persisted', 'failed')),
  conversation_id uuid references public.conversations(id) on delete set null,
  event_payload jsonb,
  received_at timestamptz not null default now(),
  claimed_at timestamptz not null default now(),
  persisted_at timestamptz,
  event_enqueued_at timestamptz,
  last_error text
);

create index mcp_inbound_event_ledger_pending_idx
  on public.mcp_inbound_event_ledger (persisted_at, event_enqueued_at)
  where status = 'persisted' and event_enqueued_at is null;

create table public.mcp_event_deliveries (
  id text primary key check (id ~ '^evt_[0-9a-f]{40}$'),
  subscription_id text not null
    references public.mcp_event_subscriptions(id) on delete cascade,
  event_id text not null,
  event_name text not null check (event_name = 'conversation.message.received'),
  occurred_at timestamptz not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'delivering', 'delivered', 'failed', 'discarded')),
  attempts integer not null default 0 check (attempts between 0 and 8),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  response_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  unique (subscription_id, event_id)
);

create index mcp_event_deliveries_pending_idx
  on public.mcp_event_deliveries (status, next_attempt_at)
  where status in ('pending', 'failed');

alter table public.mcp_event_subscriptions enable row level security;
alter table public.mcp_inbound_event_ledger enable row level security;
alter table public.mcp_event_deliveries enable row level security;

revoke all on table public.mcp_event_subscriptions from public, anon, authenticated;
revoke all on table public.mcp_inbound_event_ledger from public, anon, authenticated;
revoke all on table public.mcp_event_deliveries from public, anon, authenticated;

grant select, insert, update on table public.mcp_event_subscriptions to service_role;
grant select, insert, update on table public.mcp_inbound_event_ledger to service_role;
grant select, insert, update on table public.mcp_event_deliveries to service_role;

comment on table public.mcp_event_subscriptions is
  'Owner-bound ChatGPT MCP Events webhook subscriptions. Callback secrets are service-role-only and never returned after subscribe.';
comment on table public.mcp_inbound_event_ledger is
  'Durable Twilio MessageSid deduplication and persist-before-enqueue outbox.';
comment on table public.mcp_event_deliveries is
  'Bounded, retryable Standard Webhooks deliveries for MCP Events.';
