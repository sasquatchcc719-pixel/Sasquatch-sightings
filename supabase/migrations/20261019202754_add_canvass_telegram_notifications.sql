-- Delivery receipts and short-lived claims prevent duplicate canvassing alerts.
-- canvass_sessions already uses service-role-only access with RLS enabled.
alter table public.canvass_sessions
  add column if not exists start_telegram_claimed_at timestamptz,
  add column if not exists start_telegram_notified_at timestamptz,
  add column if not exists stop_telegram_claimed_at timestamptz,
  add column if not exists stop_telegram_notified_at timestamptz;

-- Enable future events without sending retrospective alerts for old walks.
-- An existing active walk can still send its next stop notification.
update public.canvass_sessions
set start_telegram_notified_at = now(),
    stop_telegram_notified_at = case when status = 'active' then null else now() end;
