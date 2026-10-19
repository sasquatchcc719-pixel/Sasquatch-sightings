-- Schedule each technician's switch by job date. Existing jobs and category
-- bonus records stay intact; the original invoice/recipient/rate freeze at start.
alter table public.staff_users
  add column if not exists invoice_growth_bonus_starts_on date;

alter table public.ops_appointments
  add column if not exists invoice_growth_baseline_total numeric(12,2),
  add column if not exists invoice_growth_bonus_staff_user_id uuid
    references public.staff_users(id) on delete restrict,
  add column if not exists invoice_growth_bonus_rate numeric(5,4)
    check (invoice_growth_bonus_rate > 0 and invoice_growth_bonus_rate <= 1),
  add constraint ops_appointments_invoice_growth_snapshot_check check (
    (invoice_growth_baseline_total is null
      and invoice_growth_bonus_staff_user_id is null
      and invoice_growth_bonus_rate is null)
    or (invoice_growth_baseline_total is not null
      and invoice_growth_baseline_total >= 0
      and invoice_growth_bonus_staff_user_id is not null
      and invoice_growth_bonus_rate is not null)
  );

comment on column public.staff_users.invoice_growth_bonus_starts_on is
  'First appointment date earning the invoice-growth bonus instead of category bonuses. Null keeps the original rule.';
comment on column public.ops_appointments.invoice_growth_baseline_total is
  'Original discounted invoice revenue including the minimum charge, excluding tax, gratuity and fees. Captured before technician edits.';

-- The next work/pay period begins October 25; do not change the October 11–24 run.
do $$
declare
  david_count integer;
begin
  select count(*) into david_count from public.staff_users
  where lower(trim(display_name)) = 'david gonzalez'
    and role = 'tech' and is_active = true;
  if david_count <> 1 then
    raise exception 'Expected exactly one active David Gonzalez tech, found %', david_count;
  end if;

  update public.staff_users
  set invoice_growth_bonus_starts_on = date '2026-10-25',
      updated_at = now()
  where lower(trim(display_name)) = 'david gonzalez'
    and role = 'tech' and is_active = true;
end
$$;
