-- Customer-requested cleaning reminders. At job close-out Charles or a tech
-- taps 3 / 6 / 12 months on the invoice; we text the customer an immediate
-- confirmation and queue the future reminder here. A daily cron sends due
-- rows inside the Mountain Time window (same engine shape as review_requests).
create table if not exists cleaning_reminders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references ops_customers(id) on delete cascade,
  appointment_id uuid references ops_appointments(id) on delete set null,
  invoice_id uuid references ops_invoices(id) on delete set null,
  interval_months integer not null check (interval_months in (3, 6, 12)),
  phone text not null,
  status text not null default 'pending', -- pending | sent | cancelled | skipped | failed
  skip_reason text,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  message text,
  confirmation_sid text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live reminder per appointment: re-tapping a different interval replaces
-- the old one rather than stacking two texts on the same customer.
create unique index if not exists cleaning_reminders_one_live_per_appointment
  on cleaning_reminders (appointment_id)
  where status = 'pending' and appointment_id is not null;

create index if not exists cleaning_reminders_due_idx
  on cleaning_reminders (status, scheduled_for);
create index if not exists cleaning_reminders_customer_idx
  on cleaning_reminders (customer_id, status);

alter table cleaning_reminders enable row level security;

create policy "Service role full access" on cleaning_reminders
  for all to service_role using (true);

-- $20 off $200+ — the reminder text's offer. Tiered (not flat) so the $200
-- floor is enforced server-side at booking; below $200 the discount computes
-- to zero and cannot be hand-typed onto a small job.
insert into promo_codes (code, discount_type, discount_amount, description)
values (
  'REMIND20',
  'tiered',
  0,
  '$20 off $200+ — customer-requested cleaning reminder (jobs under $200 not eligible)'
)
on conflict (code) do nothing;

insert into promo_code_tiers (promo_code_id, min_spend, discount_amount)
select id, 200.00, 20.00 from promo_codes where code = 'REMIND20'
on conflict (promo_code_id, min_spend) do nothing;
