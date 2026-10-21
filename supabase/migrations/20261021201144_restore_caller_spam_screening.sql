-- Distinguish intentional menu filtering from failed forwarding.
alter table public.call_logs
  add column if not exists caller_screening_status text
  check (caller_screening_status in ('pending','passed','voicemail','bypassed'));
