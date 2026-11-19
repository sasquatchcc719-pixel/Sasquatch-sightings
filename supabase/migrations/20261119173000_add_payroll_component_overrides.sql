create table if not exists public.ops_payroll_component_overrides (
  id uuid primary key default gen_random_uuid(),
  component text not null check (component in ('gratuity', 'add_on_bonus')),
  source_key text not null check (length(source_key) between 1 and 250),
  override_amount numeric(10, 2) not null check (
    override_amount >= 0 and override_amount <= 1000000
  ),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (component, source_key)
);

comment on table public.ops_payroll_component_overrides is
  'Owner/admin payroll amount overrides. Source invoice and job calculations remain unchanged.';

alter table public.ops_payroll_component_overrides enable row level security;
revoke all on table public.ops_payroll_component_overrides from anon, authenticated;
grant select, insert, update, delete on table public.ops_payroll_component_overrides to service_role;

create index if not exists idx_payroll_component_overrides_created_by
  on public.ops_payroll_component_overrides (created_by);

create policy "ops_payroll_component_overrides_service_only"
  on public.ops_payroll_component_overrides
  for all
  to service_role
  using (true)
  with check (true);
