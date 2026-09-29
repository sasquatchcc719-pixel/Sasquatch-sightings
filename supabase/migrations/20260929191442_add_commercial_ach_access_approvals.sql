create table if not exists public.commercial_ach_access_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ops_customers(id) on delete cascade,
  requested_by_user_id uuid not null,
  requested_by_name text not null,
  requested_by_email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'revealed', 'expired', 'delivery_failed')),
  requested_at timestamptz not null default now(),
  request_expires_at timestamptz not null default (now() + interval '24 hours'),
  decided_at timestamptz,
  access_expires_at timestamptz,
  approved_by_telegram_user_id bigint,
  telegram_chat_id bigint,
  telegram_message_id bigint,
  revealed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commercial_ach_access_one_pending_per_user
  on public.commercial_ach_access_requests (customer_id, requested_by_user_id)
  where status = 'pending';

create index if not exists commercial_ach_access_requester_history
  on public.commercial_ach_access_requests
  (customer_id, requested_by_user_id, requested_at desc);

alter table public.commercial_ach_access_requests enable row level security;

revoke all on table public.commercial_ach_access_requests from anon, authenticated;
grant all on table public.commercial_ach_access_requests to service_role;

comment on table public.commercial_ach_access_requests is
  'Server-only audit trail for one-time commercial ACH instruction access approved by the owner in Telegram.';
