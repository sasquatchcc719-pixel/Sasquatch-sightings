-- Records the moment a tech taps "Start Job" (status -> in_progress), so the
-- real worked window is job_started_at -> completed_at.
alter table public.ops_appointments
  add column if not exists job_started_at timestamptz;

-- Recovery Village after-hours premium: +$10/hr on the worked minutes after
-- 5pm for a completed job assigned to a field tech. One premium per job.
create table if not exists public.ops_after_hours_premiums (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.ops_appointments(id) on delete cascade,
  staff_user_id uuid not null references public.staff_users(id) on delete cascade,
  work_date date not null,
  premium_minutes integer not null check (premium_minutes >= 0),
  premium_rate numeric(10, 2) not null default 10.00 check (premium_rate >= 0),
  premium_pay numeric(10, 2) generated always as (
    round((premium_minutes::numeric / 60) * premium_rate, 2)
  ) stored,
  status text not null default 'approved' check (status in ('approved', 'paid')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id)
);

create index if not exists idx_ah_premiums_staff_date
  on public.ops_after_hours_premiums (staff_user_id, work_date);

alter table public.ops_after_hours_premiums enable row level security;
