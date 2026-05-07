-- Ranger agent core.
-- Adds persistent Telegram command memory, duplicate update protection,
-- and approval-gated pending actions for high-autonomy agent behavior.

create table if not exists public.ranger_command_threads (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id text not null,
  telegram_user_id text,
  status text not null default 'active',
  last_applicant_id uuid references public.ranger_applicants(id) on delete set null,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ranger_command_threads_status_check check (
    status in ('active', 'archived')
  )
);

create table if not exists public.ranger_command_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.ranger_command_threads(id) on delete cascade,
  applicant_id uuid references public.ranger_applicants(id) on delete set null,
  role text not null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ranger_command_messages_role_check check (
    role in ('owner', 'assistant', 'tool', 'system')
  )
);

create table if not exists public.ranger_pending_actions (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.ranger_command_threads(id) on delete cascade,
  applicant_id uuid references public.ranger_applicants(id) on delete cascade,
  action_type text not null,
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  requested_by text,
  approved_by text,
  cancelled_by text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  approved_at timestamptz,
  cancelled_at timestamptz,
  executed_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ranger_pending_actions_status_check check (
    status in ('pending', 'approved', 'cancelled', 'expired', 'executed', 'failed')
  )
);

create table if not exists public.ranger_telegram_updates (
  update_id bigint primary key,
  telegram_chat_id text,
  telegram_user_id text,
  processed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists ranger_command_threads_chat_idx
  on public.ranger_command_threads(telegram_chat_id, updated_at desc);

create index if not exists ranger_command_messages_thread_idx
  on public.ranger_command_messages(thread_id, created_at desc);

create index if not exists ranger_pending_actions_status_idx
  on public.ranger_pending_actions(status, expires_at, created_at);

create index if not exists ranger_pending_actions_applicant_idx
  on public.ranger_pending_actions(applicant_id, created_at desc)
  where applicant_id is not null;

drop trigger if exists set_ranger_command_threads_updated_at on public.ranger_command_threads;
create trigger set_ranger_command_threads_updated_at
  before update on public.ranger_command_threads
  for each row execute function public.set_ranger_updated_at();

drop trigger if exists set_ranger_pending_actions_updated_at on public.ranger_pending_actions;
create trigger set_ranger_pending_actions_updated_at
  before update on public.ranger_pending_actions
  for each row execute function public.set_ranger_updated_at();

alter table public.ranger_command_threads enable row level security;
alter table public.ranger_command_messages enable row level security;
alter table public.ranger_pending_actions enable row level security;
alter table public.ranger_telegram_updates enable row level security;

-- Admin APIs and agent webhooks use the service role client.
-- Keep browser access closed by default.
