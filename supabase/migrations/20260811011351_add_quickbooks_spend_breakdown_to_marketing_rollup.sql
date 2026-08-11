alter table public.marketing_weekly_rollup
  add column if not exists spend_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists spend_line_count integer not null default 0;

alter table public.marketing_weekly_rollup
  add constraint marketing_weekly_rollup_spend_breakdown_check
    check (jsonb_typeof(spend_breakdown) = 'object'),
  add constraint marketing_weekly_rollup_spend_line_count_check
    check (spend_line_count >= 0);

comment on column public.marketing_weekly_rollup.spend is
  'Marketing expense total reconciled from QuickBooks marketing accounts, recognized marketing vendors in other accounts, and non-QuickBooks campaign costs. QuickBooks lines are deduplicated by transaction line key.';
comment on column public.marketing_weekly_rollup.spend_breakdown is
  'Expense dollars grouped into plain-English marketing categories for this week and scope.';
comment on column public.marketing_weekly_rollup.spend_line_count is
  'Count of distinct QuickBooks expense lines represented in spend. Non-QuickBooks campaign labor and manual costs are excluded from this count.';
