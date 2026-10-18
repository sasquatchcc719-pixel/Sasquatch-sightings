-- Preserve both provider responses and per-domain measurement provenance.
-- Existing history stays intact; NULL audit identifies older unverified scans.
alter table public.radar_scan_runs add column if not exists organic_audit jsonb;
comment on column public.radar_scan_runs.organic_audit is
  'Independent first-page evidence, deeper observations, URLs/titles, actual checked depths and per-domain verification status. NULL means legacy unverified data.';
