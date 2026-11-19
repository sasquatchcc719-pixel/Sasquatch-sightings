create table if not exists public.ops_overtime_premiums (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references public.staff_users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  overtime_minutes integer not null check (overtime_minutes >= 0),
  premium_pay numeric(10, 2) not null check (
    premium_pay >= 0 and premium_pay <= 1000000
  ),
  calculation jsonb not null default '[]'::jsonb check (
    jsonb_typeof(calculation) = 'array'
  ),
  status text not null default 'approved' check (status in ('approved', 'paid')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_overtime_premiums_valid_period check (period_start <= period_end),
  unique (staff_user_id, period_start, period_end)
);

comment on table public.ops_overtime_premiums is
  'Applied overtime snapshots. Straight-time pay remains on timesheet entries; premium_pay stores the extra 0.5x needed for time-and-a-half.';

alter table public.ops_overtime_premiums enable row level security;
revoke all on table public.ops_overtime_premiums from anon, authenticated;
grant select, insert, update, delete on table public.ops_overtime_premiums to service_role;

create index if not exists idx_ops_overtime_premiums_period
  on public.ops_overtime_premiums (period_start, period_end);

create policy "ops_overtime_premiums_service_only"
  on public.ops_overtime_premiums
  for all
  to service_role
  using (true)
  with check (true);
