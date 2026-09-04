alter table public.ops_appointments
  add column if not exists service_concern_id uuid
  references public.ops_service_concerns(id) on delete restrict;

create unique index if not exists ops_appointments_service_concern_id_unique
  on public.ops_appointments (service_concern_id)
  where service_concern_id is not null;

comment on column public.ops_appointments.service_concern_id is
  'Approved service concern that authorized this no-charge return appointment.';
