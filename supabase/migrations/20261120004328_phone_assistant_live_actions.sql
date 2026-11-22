-- A call-scoped claim makes live voice writes at-most-once. Provider and model
-- retries can read a completed result, but a pending/unknown write is never
-- repeated automatically.
create table public.phone_assistant_actions (
  call_sid text not null references public.phone_assistant_sessions(call_sid) on delete cascade,
  action_key text not null check (action_key ~ '^[a-z][a-z0-9_-]{0,95}$'),
  status text not null default 'pending' check (status in ('pending','succeeded','failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (call_sid, action_key)
);

alter table public.phone_assistant_actions enable row level security;
revoke all on public.phone_assistant_actions from public, anon, authenticated;
revoke all on public.phone_assistant_actions from service_role;
grant select, insert, update on public.phone_assistant_actions to service_role;

create index phone_assistant_actions_created
  on public.phone_assistant_actions (created_at desc);
