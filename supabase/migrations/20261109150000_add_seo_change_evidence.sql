-- Optional evidence for SEO changes on the existing intervention timeline.
-- No historical values, access controls, schedules or notifications change.
alter table public.marketing_events
  add column if not exists seo_change jsonb,
  add column if not exists seo_revision integer not null default 0;

alter table public.marketing_events
  add constraint marketing_events_seo_change_object
  check (seo_change is null or
    (jsonb_typeof(seo_change) = 'object' and seo_change @> '{"version": 1}'::jsonb));

comment on column public.marketing_events.seo_change is
  'Versioned SEO hypothesis, exact change/deployment, baseline, review dates, observational outcomes and confounders. Not evidence of causation.';

-- Constant default is metadata-only on supported Postgres; no historic event rewrite.
alter table public.marketing_events
  add constraint marketing_events_seo_revision_nonnegative check (seo_revision >= 0);
