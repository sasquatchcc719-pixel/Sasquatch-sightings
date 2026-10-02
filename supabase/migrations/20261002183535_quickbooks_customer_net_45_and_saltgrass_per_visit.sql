alter table public.ops_customers
  add column if not exists quickbooks_payment_terms_days integer;

alter table public.ops_customers
  drop constraint if exists ops_customers_quickbooks_payment_terms_days_check;
alter table public.ops_customers
  add constraint ops_customers_quickbooks_payment_terms_days_check
  check (
    quickbooks_payment_terms_days is null
    or quickbooks_payment_terms_days between 0 and 365
  );

comment on column public.ops_customers.quickbooks_payment_terms_days is
  'Net payment-term days sent on this customer''s QuickBooks invoices. Null leaves QuickBooks terms unset.';

do $$
begin
  if (
    select count(*)
    from public.ops_customers
    where lower(trim(business_name)) = 'recovery village'
  ) <> 1 then
    raise exception 'Expected exactly one canonical Recovery Village customer';
  end if;

  if (
    select count(*)
    from public.ops_customers
    where lower(trim(business_name)) = 'saltgrass colorado springs'
  ) <> 1 then
    raise exception 'Expected exactly one Saltgrass Colorado Springs customer';
  end if;
end $$;

update public.ops_customers
set quickbooks_payment_terms_days = 45,
    billing_mode = 'monthly_consolidated',
    updated_at = now()
where lower(trim(business_name)) = 'recovery village';

update public.ops_customers
set quickbooks_payment_terms_days = 45,
    billing_mode = 'immediate',
    updated_at = now()
where lower(trim(business_name)) = 'saltgrass colorado springs';

update public.ops_recurring_templates template
set invoice_mode = 'per_visit',
    updated_at = now()
from public.ops_customers customer
where template.customer_id = customer.id
  and lower(trim(customer.business_name)) = 'saltgrass colorado springs';

update public.ops_appointments appointment
set quickbooks_sync_status = 'pending',
    updated_at = now()
from public.ops_customers customer,
     public.ops_recurring_templates template
where appointment.customer_id = customer.id
  and appointment.recurring_template_id = template.id
  and template.customer_id = customer.id
  and lower(trim(customer.business_name)) = 'saltgrass colorado springs'
  and appointment.quickbooks_sync_status = 'held';

insert into public.ops_invoices (
  appointment_id,
  status,
  payment_status,
  subtotal,
  discount_amount,
  total,
  sync_status
)
select
  appointment.id,
  'draft',
  'unpaid',
  line_totals.subtotal,
  greatest(line_totals.subtotal - coalesce(appointment.quoted_total, line_totals.subtotal), 0),
  coalesce(appointment.quoted_total, line_totals.subtotal),
  'pending'
from public.ops_appointments appointment
join public.ops_customers customer
  on customer.id = appointment.customer_id
join public.ops_recurring_templates template
  on template.id = appointment.recurring_template_id
cross join lateral (
  select round(coalesce(sum(line.line_total), 0)::numeric, 2) as subtotal
  from public.ops_appointment_line_items line
  where line.appointment_id = appointment.id
) line_totals
where lower(trim(customer.business_name)) = 'saltgrass colorado springs'
  and template.customer_id = customer.id
  and appointment.status <> 'cancelled'
  and not exists (
    select 1
    from public.ops_invoices invoice
    where invoice.appointment_id = appointment.id
  );

insert into public.ops_invoice_line_items (
  invoice_id,
  appointment_line_item_id,
  description,
  quantity,
  unit_price,
  line_total
)
select
  invoice.id,
  appointment_line.id,
  appointment_line.name_snapshot,
  appointment_line.quantity,
  appointment_line.unit_price,
  appointment_line.line_total
from public.ops_invoices invoice
join public.ops_appointments appointment
  on appointment.id = invoice.appointment_id
join public.ops_customers customer
  on customer.id = appointment.customer_id
join public.ops_recurring_templates template
  on template.id = appointment.recurring_template_id
join public.ops_appointment_line_items appointment_line
  on appointment_line.appointment_id = appointment.id
where lower(trim(customer.business_name)) = 'saltgrass colorado springs'
  and template.customer_id = customer.id
  and not exists (
    select 1
    from public.ops_invoice_line_items invoice_line
    where invoice_line.invoice_id = invoice.id
      and invoice_line.appointment_line_item_id = appointment_line.id
  );

do $$
begin
  if not exists (
    select 1
    from public.ops_customers
    where lower(trim(business_name)) = 'recovery village'
      and billing_mode = 'monthly_consolidated'
      and quickbooks_payment_terms_days = 45
  ) then
    raise exception 'Canonical Recovery Village customer was not configured for monthly Net 45 billing';
  end if;

  if not exists (
    select 1
    from public.ops_customers customer
    join public.ops_recurring_templates template
      on template.customer_id = customer.id
    where lower(trim(customer.business_name)) = 'saltgrass colorado springs'
      and customer.billing_mode = 'immediate'
      and customer.quickbooks_payment_terms_days = 45
      and template.invoice_mode = 'per_visit'
  ) then
    raise exception 'Saltgrass was not configured for per-visit Net 45 billing';
  end if;

  if exists (
    select 1
    from public.ops_appointments appointment
    join public.ops_customers customer
      on customer.id = appointment.customer_id
    join public.ops_recurring_templates template
      on template.id = appointment.recurring_template_id
    left join public.ops_invoices invoice
      on invoice.appointment_id = appointment.id
    where lower(trim(customer.business_name)) = 'saltgrass colorado springs'
      and template.customer_id = customer.id
      and appointment.status <> 'cancelled'
      and invoice.id is null
  ) then
    raise exception 'A Saltgrass recurring visit is still missing its per-visit invoice';
  end if;
end $$;
