-- DataForSEO expansion. Applied remotely via Supabase MCP; kept here for repo history.
--
-- NOTE: public.gbp_reviews ALREADY EXISTED and already held 88 rows going back to
-- 2026-06-11 -- including seven 5-star reviews Google has since stopped returning.
-- That history is the evidence for the post-reinstatement review loss, so this
-- migration EXTENDS that table rather than replacing it. Do not drop it.

ALTER TABLE public.gbp_reviews
  ADD COLUMN IF NOT EXISTS cid text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS profile_url text,
  ADD COLUMN IF NOT EXISTS owner_answer text,
  ADD COLUMN IF NOT EXISTS local_guide boolean,
  ADD COLUMN IF NOT EXISTS reviewer_review_count integer,
  ADD COLUMN IF NOT EXISTS photos_count integer,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS missing_since timestamptz,
  ADD COLUMN IF NOT EXISTS attributes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS raw jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.gbp_reviews
SET last_seen_at = COALESCE(last_seen_at, first_seen_at)
WHERE last_seen_at IS NULL;

CREATE INDEX IF NOT EXISTS gbp_reviews_last_seen_idx
  ON public.gbp_reviews (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS gbp_reviews_missing_idx
  ON public.gbp_reviews (missing_since) WHERE missing_since IS NOT NULL;
CREATE INDEX IF NOT EXISTS gbp_reviews_attributes_idx
  ON public.gbp_reviews USING gin (attributes);

-- The pair (votes_count, reviews_returned) is the point: when they disagree,
-- Google's aggregate counter is desynced from its own review list.
-- Verified live 2026-08-11: counter 80, list 81, same API payload.
CREATE TABLE IF NOT EXISTS public.gbp_profile_snapshots (
  id bigserial PRIMARY KEY,
  cid text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'dataforseo_my_business_info',
  title text,
  rating_value numeric,
  votes_count integer,
  reviews_returned integer,
  is_claimed boolean,
  phone text,
  url text,
  category text,
  work_time jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS gbp_profile_snapshots_cid_time_idx
  ON public.gbp_profile_snapshots (cid, captured_at DESC);

CREATE TABLE IF NOT EXISTS public.gbp_review_pulls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cid text NOT NULL,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  aggregate_count integer,
  returned_count integer NOT NULL DEFAULT 0,
  rating_value numeric,
  count_mismatch boolean NOT NULL DEFAULT false,
  newly_missing integer NOT NULL DEFAULT 0,
  cost numeric,
  notes text
);
CREATE INDEX IF NOT EXISTS gbp_review_pulls_cid_time_idx
  ON public.gbp_review_pulls (cid, pulled_at DESC);

CREATE TABLE IF NOT EXISTS public.gbp_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cid text NOT NULL,
  question_hash text NOT NULL,
  question_text text,
  asked_at timestamptz,
  profile_name text,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer_count integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (cid, question_hash)
);

-- The gap between google_volume and llm_volume is the content-opportunity
-- signal: high llm + low google = a topic competitors' keyword tools can't see.
CREATE TABLE IF NOT EXISTS public.keyword_volume_snapshots (
  id bigserial PRIMARY KEY,
  keyword text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  google_volume integer,
  google_competition text,
  google_cpc numeric,
  llm_volume integer,
  location_code integer NOT NULL DEFAULT 2840
);
CREATE INDEX IF NOT EXISTS keyword_volume_kw_time_idx
  ON public.keyword_volume_snapshots (keyword, captured_at DESC);

CREATE TABLE IF NOT EXISTS public.brand_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phrase text NOT NULL,
  url text NOT NULL,
  domain text,
  title text,
  snippet text,
  published_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  reviewed boolean NOT NULL DEFAULT false,
  UNIQUE (phrase, url)
);
CREATE INDEX IF NOT EXISTS brand_mentions_seen_idx
  ON public.brand_mentions (first_seen_at DESC);

-- Bing organic rank (ChatGPT proxy -- our measured ChatGPT SAIV is ~0).
CREATE TABLE IF NOT EXISTS public.bing_rank_snapshots (
  id bigserial PRIMARY KEY,
  keyword text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  our_rank integer,
  top_results jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS bing_rank_kw_time_idx
  ON public.bing_rank_snapshots (keyword, captured_at DESC);

ALTER TABLE public.gbp_profile_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gbp_review_pulls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gbp_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keyword_volume_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bing_rank_snapshots ENABLE ROW LEVEL SECURITY;
