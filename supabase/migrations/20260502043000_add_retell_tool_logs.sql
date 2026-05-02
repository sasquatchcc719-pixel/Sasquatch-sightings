create table if not exists public.retell_tool_logs (
  id uuid primary key default gen_random_uuid(),
  call_id text,
  caller_phone text,
  function_name text not null,
  request_args jsonb not null default '{}'::jsonb,
  response_body jsonb,
  success boolean not null default false,
  http_status integer,
  error_message text,
  appointment_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists retell_tool_logs_created_at_idx
  on public.retell_tool_logs (created_at desc);

create index if not exists retell_tool_logs_call_id_idx
  on public.retell_tool_logs (call_id);

create index if not exists retell_tool_logs_function_name_idx
  on public.retell_tool_logs (function_name);

create index if not exists retell_tool_logs_success_idx
  on public.retell_tool_logs (success);

alter table public.retell_tool_logs enable row level security;

drop policy if exists "retell_tool_logs_admin_read" on public.retell_tool_logs;

create table if not exists public.retell_call_logs (
  id uuid primary key default gen_random_uuid(),
  call_id text,
  caller_phone text,
  agent_id text,
  agent_name text,
  call_status text,
  call_type text,
  start_timestamp timestamptz,
  end_timestamp timestamptz,
  duration_seconds integer,
  transcript text,
  recording_url text,
  disconnection_reason text,
  sentiment text,
  call_successful boolean,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists retell_call_logs_created_at_idx
  on public.retell_call_logs (created_at desc);

create index if not exists retell_call_logs_call_id_idx
  on public.retell_call_logs (call_id);

create index if not exists retell_call_logs_caller_phone_idx
  on public.retell_call_logs (caller_phone);

alter table public.retell_call_logs enable row level security;
