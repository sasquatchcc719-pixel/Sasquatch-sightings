alter table public.business_cost_snapshots
  add column if not exists period_kind text;

update public.business_cost_snapshots
set period_kind = 'rolling_28_day'
where period_kind is null;

alter table public.business_cost_snapshots
  alter column period_kind set default 'weekly',
  alter column period_kind set not null;

alter table public.business_cost_snapshots
  drop constraint if exists business_cost_snapshots_unique_window;

alter table public.business_cost_snapshots
  add constraint business_cost_snapshots_period_kind_check
    check (period_kind in ('rolling_28_day', 'weekly', 'year_to_date')),
  add constraint business_cost_snapshots_unique_period_window
    unique (period_kind, window_start, window_end);

create index if not exists business_cost_snapshots_period_end_idx
  on public.business_cost_snapshots (period_kind, window_end desc);

comment on column public.business_cost_snapshots.period_kind is
  'Separates non-overlapping Thursday-Wednesday weekly snapshots, current-year YTD averages, and retired rolling 28-day history.';

comment on table public.business_cost_snapshots is
  'Auditable weekly and year-to-date revenue-versus-cost snapshots. QuickBooks cost comes from the cash-basis P&L; owner-adjusted cost adds only recorded owner field hours at the configured replacement rate.';
