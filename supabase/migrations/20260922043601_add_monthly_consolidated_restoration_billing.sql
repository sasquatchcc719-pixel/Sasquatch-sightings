-- A customer-level policy is the single source of truth. Template-level
-- invoice_mode remains for backwards compatibility, but monthly customers are
-- consolidated regardless of how an individual recurring template is marked.
alter table public.ops_customers
  add column if not exists billing_mode text not null default 'immediate';

alter table public.ops_customers
  drop constraint if exists ops_customers_billing_mode_check;
alter table public.ops_customers
  add constraint ops_customers_billing_mode_check
  check (billing_mode in ('immediate', 'monthly_consolidated'));

-- Recovery Village's canonical record is identified by its existing QBO link,
-- exact business name, and billing contact. Near-duplicate customer names are
-- deliberately not enough to receive a financial policy.
update public.ops_customers customer
set billing_mode = 'monthly_consolidated', updated_at = now()
where exists (
  select 1
  from public.ops_recurring_templates template
  where template.customer_id = customer.id
    and template.invoice_mode = 'batch_monthly'
    and template.is_active = true
);

update public.ops_customers
set billing_mode = 'monthly_consolidated', updated_at = now()
where quickbooks_customer_id = '19'
  and lower(trim(business_name)) = 'recovery village'
  and lower(trim(email)) = 'lanjohnson@palmerlakerecovery.com';

do $$
begin
  if not exists (
    select 1
    from public.ops_customers
    where quickbooks_customer_id = '19'
      and lower(trim(business_name)) = 'recovery village'
      and lower(trim(email)) = 'lanjohnson@palmerlakerecovery.com'
      and billing_mode = 'monthly_consolidated'
  ) then
    raise exception 'Canonical Recovery Village customer was not found; monthly billing policy not applied';
  end if;
end $$;

-- Closing a restoration job for a monthly customer freezes an auditable
-- snapshot here. It does not create an ops_invoice; the project remains ready
-- for review until it is selected into the month's consolidated invoice.
alter table public.restoration_projects
  add column if not exists billing_month date,
  add column if not exists billing_status text not null default 'not_ready',
  add column if not exists billing_snapshot jsonb,
  add column if not exists final_report_storage_path text,
  add column if not exists final_report_sha256 text,
  add column if not exists final_report_version integer,
  add column if not exists final_report_frozen_at timestamptz;

alter table public.restoration_projects
  drop constraint if exists restoration_projects_billing_status_check;
alter table public.restoration_projects
  add constraint restoration_projects_billing_status_check
  check (billing_status in ('not_ready', 'ready', 'batched', 'sent'));

alter table public.restoration_projects
  drop constraint if exists restoration_projects_billing_month_first_check;
alter table public.restoration_projects
  add constraint restoration_projects_billing_month_first_check
  check (billing_month is null or billing_month = date_trunc('month', billing_month)::date);

alter table public.restoration_projects
  drop constraint if exists restoration_projects_frozen_report_complete_check;
alter table public.restoration_projects
  add constraint restoration_projects_frozen_report_complete_check
  check (
    (final_report_storage_path is null and final_report_sha256 is null and final_report_version is null and final_report_frozen_at is null)
    or
    (final_report_storage_path is not null and final_report_sha256 is not null and final_report_version is not null and final_report_frozen_at is not null)
  );

create index if not exists restoration_projects_monthly_billing_ready_idx
  on public.restoration_projects(customer_id, billing_month, closed_at)
  where billing_status = 'ready';

-- A batch entry may now represent either a completed appointment or one closed
-- restoration project. All billing facts are copied into the snapshot so the
-- invoice never changes underneath a sent QuickBooks transaction.
alter table public.ops_batch_invoice_entries
  alter column appointment_id drop not null,
  add column if not exists restoration_project_id uuid references public.restoration_projects(id) on delete restrict,
  add column if not exists entry_type text not null default 'appointment',
  add column if not exists service_date date,
  add column if not exists service_address_snapshot text,
  add column if not exists attachment_status text not null default 'not_required',
  add column if not exists quickbooks_attachable_id text,
  add column if not exists attachment_error text,
  add column if not exists attached_at timestamptz;

update public.ops_batch_invoice_entries entry
set service_date = appointment.appointment_date
from public.ops_appointments appointment
where entry.appointment_id = appointment.id
  and entry.service_date is null;

alter table public.ops_batch_invoice_entries
  alter column service_date set not null;

alter table public.ops_batch_invoice_entries
  drop constraint if exists ops_batch_invoice_entries_entry_type_check;
alter table public.ops_batch_invoice_entries
  add constraint ops_batch_invoice_entries_entry_type_check
  check (entry_type in ('appointment', 'restoration'));

alter table public.ops_batch_invoice_entries
  drop constraint if exists ops_batch_invoice_entries_source_check;
alter table public.ops_batch_invoice_entries
  add constraint ops_batch_invoice_entries_source_check
  check (
    (entry_type = 'appointment' and appointment_id is not null and restoration_project_id is null)
    or
    (entry_type = 'restoration' and appointment_id is null and restoration_project_id is not null)
  );

alter table public.ops_batch_invoice_entries
  drop constraint if exists ops_batch_invoice_entries_attachment_status_check;
alter table public.ops_batch_invoice_entries
  add constraint ops_batch_invoice_entries_attachment_status_check
  check (attachment_status in ('not_required', 'pending', 'attached', 'failed'));

create unique index if not exists ops_batch_invoice_entries_appointment_unique
  on public.ops_batch_invoice_entries(appointment_id)
  where appointment_id is not null;
create unique index if not exists ops_batch_invoice_entries_restoration_unique
  on public.ops_batch_invoice_entries(restoration_project_id)
  where restoration_project_id is not null;
create unique index if not exists ops_batch_invoices_customer_month_unique
  on public.ops_batch_invoices(customer_id, month);

alter table public.ops_batch_invoices
  add column if not exists attachment_status text not null default 'not_required',
  add column if not exists attachment_error text,
  add column if not exists sent_at timestamptz;

alter table public.ops_batch_invoices
  drop constraint if exists ops_batch_invoices_attachment_status_check;
alter table public.ops_batch_invoices
  add constraint ops_batch_invoices_attachment_status_check
  check (attachment_status in ('not_required', 'pending', 'partial', 'complete'));

-- Final reports contain customer and insurance information. They are private;
-- staff access is mediated by authenticated server routes and short-lived URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'restoration-reports',
  'restoration-reports',
  false,
  26214400,
  array['application/pdf']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on column public.ops_customers.billing_mode is
  'Customer-level invoice policy. monthly_consolidated overrides recurring template invoice_mode.';
comment on column public.restoration_projects.billing_snapshot is
  'Immutable close-time billing facts used by a later monthly batch invoice.';
comment on column public.restoration_projects.final_report_sha256 is
  'SHA-256 of the exact private PDF later attached to QuickBooks.';

-- Close snapshots and frozen reports are evidence. They may be populated once,
-- but never rewritten afterward.
create or replace function public.guard_restoration_billing_snapshot()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.billing_snapshot is not null and new.billing_snapshot is distinct from old.billing_snapshot then
    raise exception 'restoration billing snapshot is immutable';
  end if;
  if old.final_report_storage_path is not null and (
    new.final_report_storage_path is distinct from old.final_report_storage_path
    or new.final_report_sha256 is distinct from old.final_report_sha256
    or new.final_report_version is distinct from old.final_report_version
    or new.final_report_frozen_at is distinct from old.final_report_frozen_at
  ) then
    raise exception 'frozen restoration report is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_restoration_billing_snapshot_update
  on public.restoration_projects;
create trigger guard_restoration_billing_snapshot_update
before update on public.restoration_projects
for each row execute function public.guard_restoration_billing_snapshot();

-- Once QuickBooks invoice creation has started, membership and money are
-- locked. Attachment status remains mutable so failed uploads can resume.
create or replace function public.guard_started_batch_invoice()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  started boolean;
begin
  if tg_table_name = 'ops_batch_invoices' then
    if old.quickbooks_invoice_id is not null and (
      new.customer_id is distinct from old.customer_id
      or new.month is distinct from old.month
      or new.subtotal is distinct from old.subtotal
      or new.discount_amount is distinct from old.discount_amount
      or new.total is distinct from old.total
      or new.invoice_number is distinct from old.invoice_number
    ) then
      raise exception 'QuickBooks batch invoice financials are immutable';
    end if;
    return new;
  end if;

  select invoice.quickbooks_invoice_id is not null
  into started
  from public.ops_batch_invoices invoice
  where invoice.id = case
    when tg_op = 'DELETE' then old.batch_invoice_id
    else new.batch_invoice_id
  end;

  if started then
    if tg_op = 'DELETE' then
      raise exception 'QuickBooks batch invoice membership is immutable';
    elsif tg_op = 'INSERT' then
      raise exception 'QuickBooks batch invoice membership is immutable';
    elsif (
      new.batch_invoice_id is distinct from old.batch_invoice_id
      or new.appointment_id is distinct from old.appointment_id
      or new.restoration_project_id is distinct from old.restoration_project_id
      or new.entry_type is distinct from old.entry_type
      or new.service_date is distinct from old.service_date
      or new.service_address_snapshot is distinct from old.service_address_snapshot
      or new.line_items_snapshot is distinct from old.line_items_snapshot
      or new.subtotal is distinct from old.subtotal
    ) then
      raise exception 'QuickBooks batch invoice snapshot is immutable';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_started_batch_invoice_update
  on public.ops_batch_invoices;
create trigger guard_started_batch_invoice_update
before update on public.ops_batch_invoices
for each row execute function public.guard_started_batch_invoice();

drop trigger if exists guard_started_batch_entry_change
  on public.ops_batch_invoice_entries;
create trigger guard_started_batch_entry_change
before insert or update or delete on public.ops_batch_invoice_entries
for each row execute function public.guard_started_batch_invoice();
