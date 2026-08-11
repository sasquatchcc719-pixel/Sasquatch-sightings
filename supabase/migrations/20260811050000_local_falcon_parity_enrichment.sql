-- Enrich Local Falcon caches for full API parity in Sightings.
-- Applied remotely via Supabase MCP; kept here for repo history.

ALTER TABLE public.local_falcon_scans
  ADD COLUMN IF NOT EXISTS saiv numeric,
  ADD COLUMN IF NOT EXISTS osolv numeric,
  ADD COLUMN IF NOT EXISTS campaign_key text,
  ADD COLUMN IF NOT EXISTS location jsonb,
  ADD COLUMN IF NOT EXISTS ai_analysis jsonb,
  ADD COLUMN IF NOT EXISTS rankings jsonb,
  ADD COLUMN IF NOT EXISTS places jsonb,
  ADD COLUMN IF NOT EXISTS sources jsonb,
  ADD COLUMN IF NOT EXISTS heatmap_url text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS raw jsonb;

CREATE TABLE IF NOT EXISTS public.local_falcon_competitor_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key text NOT NULL UNIQUE,
  place_id text,
  keyword text,
  platform text,
  scanned_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.local_falcon_competitor_points (
  id bigserial PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES public.local_falcon_competitor_reports(id) ON DELETE CASCADE,
  competitor_place_id text,
  competitor_name text,
  idx integer,
  lat double precision,
  lng double precision,
  rank integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS local_falcon_competitor_points_report_idx
  ON public.local_falcon_competitor_points (report_id);

CREATE TABLE IF NOT EXISTS public.local_falcon_trend_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key text NOT NULL UNIQUE,
  place_id text,
  keyword text,
  platform text,
  grid_size integer,
  radius numeric,
  series jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.local_falcon_location_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key text NOT NULL UNIQUE,
  place_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.local_falcon_keyword_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key text NOT NULL UNIQUE,
  keyword text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.local_falcon_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_key text NOT NULL UNIQUE,
  name text,
  status text,
  frequency text,
  keywords jsonb,
  locations jsonb,
  grid_size integer,
  radius numeric,
  measurement text,
  last_run text,
  next_run text,
  arp numeric,
  atrp numeric,
  solv numeric,
  arp_move numeric,
  atrp_move numeric,
  solv_move numeric,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.local_falcon_campaign_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_key text NOT NULL,
  run_date text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_key, run_date)
);

CREATE TABLE IF NOT EXISTS public.local_falcon_guard_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id text NOT NULL UNIQUE,
  status text,
  location jsonb,
  date_added text,
  date_last text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.local_falcon_guard_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS local_falcon_guard_reports_place_idx
  ON public.local_falcon_guard_reports (place_id);

CREATE TABLE IF NOT EXISTS public.local_falcon_reviews_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key text NOT NULL UNIQUE,
  reviews_key text,
  place_id text,
  name text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.local_falcon_account_snapshot (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  credits jsonb,
  email text,
  package jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.local_falcon_competitor_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_falcon_competitor_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_falcon_trend_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_falcon_location_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_falcon_keyword_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_falcon_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_falcon_campaign_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_falcon_guard_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_falcon_guard_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_falcon_reviews_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_falcon_account_snapshot ENABLE ROW LEVEL SECURITY;
