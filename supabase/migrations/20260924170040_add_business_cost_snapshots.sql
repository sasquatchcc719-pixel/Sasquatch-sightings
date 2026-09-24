create table if not exists public.business_cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  window_start date not null,
  window_end date not null,
  captured_at timestamptz not null default now(),
  revenue numeric(12,2) not null,
  productive_hours numeric(10,2) not null,
  quickbooks_cost numeric(12,2) not null,
  excluded_bookkeeping_adjustments numeric(12,2) not null default 0,
  owner_field_hours numeric(10,2) not null default 0,
  owner_replacement_cost numeric(12,2) not null default 0,
  revenue_per_hour numeric(10,2) not null,
  book_cost_per_hour numeric(10,2) not null,
  owner_adjusted_cost_per_hour numeric(10,2) not null,
  book_cost_pct numeric(7,2) not null,
  owner_adjusted_cost_pct numeric(7,2) not null,
  owner_adjusted_margin_pct numeric(7,2) not null,
  expense_breakdown jsonb not null default '{}'::jsonb,
  constraint business_cost_snapshots_window_order
    check (window_end >= window_start),
  constraint business_cost_snapshots_unique_window
    unique (window_start, window_end)
);

comment on table public.business_cost_snapshots is
  'Auditable trailing-28-day revenue-versus-cost snapshots. QuickBooks cost comes from the cash-basis P&L; owner-adjusted cost adds only recorded owner field hours at the configured replacement rate.';

comment on column public.business_cost_snapshots.excluded_bookkeeping_adjustments is
  'QuickBooks reconciliation-discrepancy amount removed from operating cost. Owner draws, income-tax estimates, transfers, investments, and loan principal never enter the P&L source total.';

create index if not exists business_cost_snapshots_window_end_idx
  on public.business_cost_snapshots (window_end desc);

alter table public.business_cost_snapshots enable row level security;

revoke all on table public.business_cost_snapshots from anon, authenticated;
grant select, insert, update on table public.business_cost_snapshots to service_role;
