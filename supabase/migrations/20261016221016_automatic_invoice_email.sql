-- Only explicit new job close-outs enqueue rows. No historical backfill.
create table public.ops_invoice_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null unique references public.ops_invoices(id) on delete cascade,
  appointment_id uuid not null references public.ops_appointments(id) on delete cascade,
  customer_id uuid not null references public.ops_customers(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped', 'review')),
  payload jsonb,
  source_hash text,
  first_attempt_at timestamptz,
  resend_id text,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ops_invoice_email_deliveries_pending_idx
  on public.ops_invoice_email_deliveries(created_at)
  where status in ('pending', 'failed');
alter table public.ops_invoice_email_deliveries enable row level security;
revoke all on public.ops_invoice_email_deliveries from public, anon, authenticated;
grant all on public.ops_invoice_email_deliveries to service_role;
