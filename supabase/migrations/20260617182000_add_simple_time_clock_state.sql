alter table ops_timesheet_entries
  add column if not exists clock_state text not null default 'complete'
    check (clock_state in ('active', 'on_break', 'complete')),
  add column if not exists break_started_at timestamptz;

create index if not exists idx_ops_timesheet_entries_active_clock
  on ops_timesheet_entries (staff_user_id, clock_state, started_at)
  where clock_state in ('active', 'on_break');
