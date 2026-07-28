-- QuickBooks sync jobs used to treat 'failed' as terminal: the cron only ever
-- selected status='pending', so a single transient error (network blip, token
-- refresh, QBO 5xx) parked an invoice forever until someone noticed the red
-- badge and clicked Retry by hand. Eleven invoices accumulated over 25 days
-- that way, silently.
--
-- Jobs now stay 'pending' and carry a next_retry_at while attempts remain, so
-- the existing 15-minute cron picks them back up on a backoff schedule. Only
-- once retries are exhausted does a job go 'failed' — and that is what fires
-- the Telegram alert (alerted_at makes it fire once, not every cron run).

alter table ops_quickbooks_sync_jobs
  add column if not exists next_retry_at timestamptz,
  add column if not exists alerted_at timestamptz;

-- The cron's hot path: due work, oldest first.
create index if not exists idx_qb_sync_jobs_due
  on ops_quickbooks_sync_jobs (status, next_retry_at)
  where status = 'pending';

-- Revive the existing dead-ended failures so the new retry ladder gets a
-- crack at them instead of leaving them stranded. Attempts reset to 0; the
-- ones already in QuickBooks self-resolve on the next run via the existing
-- quickbooks_invoice_id short-circuit.
update ops_quickbooks_sync_jobs
set status = 'pending',
    sync_attempts = 0,
    next_retry_at = now(),
    alerted_at = null,
    updated_at = now()
where status = 'failed';
