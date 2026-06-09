-- Payable timesheets are intentionally separate from GPS activity history.

alter table staff_users
  alter column user_id drop not null;

create table if not exists ops_timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid references staff_users(id) on delete cascade not null,
  work_date date not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  break_minutes integer not null default 0
    check (break_minutes >= 0),
  payable_minutes integer not null
    check (payable_minutes >= 0),
  hourly_rate numeric(10, 2) not null default 0
    check (hourly_rate >= 0),
  gross_pay numeric(10, 2) generated always as (
    round((payable_minutes::numeric / 60) * hourly_rate, 2)
  ) stored,
  work_type text not null default 'training'
    check (work_type in ('training', 'job', 'admin', 'other')),
  source text not null default 'manual'
    check (source in ('manual', 'calculated')),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'paid')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_timesheet_entries_valid_range check (started_at < ended_at)
);

alter table ops_timesheet_entries
  add column if not exists hourly_rate numeric(10, 2) not null default 0
    check (hourly_rate >= 0),
  add column if not exists gross_pay numeric(10, 2) generated always as (
    round((payable_minutes::numeric / 60) * hourly_rate, 2)
  ) stored;

create index if not exists idx_ops_timesheet_entries_staff_date
  on ops_timesheet_entries (staff_user_id, work_date);

create index if not exists idx_ops_timesheet_entries_date_status
  on ops_timesheet_entries (work_date, status);

alter table ops_timesheet_entries enable row level security;

create policy "ops_timesheet_entries_owner_read"
  on ops_timesheet_entries for select
  using (app_has_role(array['owner']));

create policy "ops_timesheet_entries_owner_write"
  on ops_timesheet_entries for all
  using (app_has_role(array['owner']))
  with check (app_has_role(array['owner']));

grant select, insert, update, delete
  on table public.ops_timesheet_entries
  to service_role;
