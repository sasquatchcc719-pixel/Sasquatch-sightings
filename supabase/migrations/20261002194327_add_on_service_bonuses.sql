-- Persist the original service-category scope and any technician-sold category
-- additions so payroll and the technician portal read the same source of truth.

alter table public.staff_users
  add column if not exists add_on_bonus_rate numeric(5,4) not null default 0;

alter table public.staff_users
  drop constraint if exists staff_users_add_on_bonus_rate_check;

alter table public.staff_users
  add constraint staff_users_add_on_bonus_rate_check
  check (add_on_bonus_rate >= 0 and add_on_bonus_rate <= 1);

alter table public.ops_appointments
  add column if not exists commission_baseline_total numeric(12,2),
  add column if not exists commission_baseline_captured_at timestamptz,
  add column if not exists add_on_bonus_baseline_categories text[];

alter table public.ops_appointment_line_items
  add column if not exists add_on_bonus_staff_user_id uuid
    references public.staff_users(id) on delete set null,
  add column if not exists add_on_bonus_category text,
  add column if not exists add_on_bonus_rate numeric(5,4);

alter table public.ops_appointment_line_items
  drop constraint if exists ops_appointment_line_items_add_on_bonus_category_check;

alter table public.ops_appointment_line_items
  add constraint ops_appointment_line_items_add_on_bonus_category_check
  check (
    add_on_bonus_category is null
    or add_on_bonus_category in (
      'carpet_cleaning',
      'tile_and_grout',
      'rug_cleaning',
      'upholstery_cleaning'
    )
  );

alter table public.ops_appointment_line_items
  drop constraint if exists ops_appointment_line_items_add_on_bonus_rate_check;

alter table public.ops_appointment_line_items
  add constraint ops_appointment_line_items_add_on_bonus_rate_check
  check (
    add_on_bonus_rate is null
    or (add_on_bonus_rate >= 0 and add_on_bonus_rate <= 1)
  );

create index if not exists ops_appointment_line_items_add_on_bonus_staff_idx
  on public.ops_appointment_line_items (add_on_bonus_staff_user_id)
  where add_on_bonus_staff_user_id is not null;

comment on column public.staff_users.add_on_bonus_rate is
  'Commission rate snapshotted onto qualifying technician-added service lines.';
comment on column public.ops_appointments.add_on_bonus_baseline_categories is
  'Qualifying service categories present before the technician starts or edits the job.';
comment on column public.ops_appointment_line_items.add_on_bonus_category is
  'New qualifying service category sold onsite by the attributed technician.';

do $$
declare
  david_count integer;
begin
  select count(*) into david_count
  from public.staff_users
  where lower(trim(display_name)) = 'david gonzalez'
    and role = 'tech'
    and is_active = true;

  if david_count <> 1 then
    raise exception 'Expected exactly one active David Gonzalez tech, found %', david_count;
  end if;

  update public.staff_users
  set add_on_bonus_rate = 0.10,
      updated_at = now()
  where lower(trim(display_name)) = 'david gonzalez'
    and role = 'tech'
    and is_active = true;
end
$$;
