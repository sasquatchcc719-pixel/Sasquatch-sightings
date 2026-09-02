-- Audit trail for the simple tech time clock. Every clock action (including
-- rejected and failed ones) lands here so payroll can see exactly what a tech's
-- phone sent and when, instead of guessing from the resulting timesheet row.

create table if not exists ops_time_clock_events (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid references staff_users(id) on delete cascade,
  entry_id uuid references ops_timesheet_entries(id) on delete set null,
  action text not null
    check (action in ('clock_in', 'clock_out', 'undo_clock_out', 'start_break', 'end_break')),
  result text not null
    check (result in ('ok', 'rejected', 'error')),
  message text,
  client_sent_at timestamptz,
  user_agent text,
  ip text,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ops_time_clock_events_staff_created
  on ops_time_clock_events (staff_user_id, created_at desc);

create index if not exists idx_ops_time_clock_events_entry
  on ops_time_clock_events (entry_id);

alter table ops_time_clock_events enable row level security;

comment on table ops_time_clock_events is
  'Append-only log of tech time clock actions (server-side, via service role). Used by payroll to audit clock in/out disputes.';
