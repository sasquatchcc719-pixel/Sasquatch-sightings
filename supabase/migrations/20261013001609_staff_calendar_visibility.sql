-- Calendar visibility is independent of the active login and field permissions.
ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS show_on_calendar boolean NOT NULL DEFAULT true;
