alter table public.ops_timesheet_entries
  add column if not exists gps_shift_id uuid
    references public.gps_shifts(id) on delete set null;

drop index if exists public.idx_ops_timesheet_entries_gps_shift;

create unique index idx_ops_timesheet_entries_gps_shift
  on public.ops_timesheet_entries (gps_shift_id);
