alter table public.gps_shifts
  add column if not exists break_started_at timestamptz,
  add column if not exists break_minutes integer not null default 0
    check (break_minutes >= 0);

comment on column public.gps_shifts.break_started_at
  is 'Set while the tech is actively on break during a clocked-in shift.';

comment on column public.gps_shifts.break_minutes
  is 'Completed break minutes accumulated during the shift; copied to payroll at clock-out.';
