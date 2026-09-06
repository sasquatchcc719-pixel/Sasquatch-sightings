alter table public.ops_commercial_agreements
  add column if not exists setup_completed_notified_at timestamptz;

comment on column public.ops_commercial_agreements.setup_completed_notified_at is
  'When the owner Telegram alert was sent after a commercial customer completed portal setup.';
