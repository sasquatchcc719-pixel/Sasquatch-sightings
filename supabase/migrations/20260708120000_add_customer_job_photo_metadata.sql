ALTER TABLE public.ops_job_photos
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'staff',
  ADD COLUMN IF NOT EXISTS uploaded_by_label text,
  ADD COLUMN IF NOT EXISTS original_filename text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ops_job_photos_source_check'
  ) THEN
    ALTER TABLE public.ops_job_photos
      ADD CONSTRAINT ops_job_photos_source_check
      CHECK (source IN ('staff', 'customer'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ops_job_photos_source_idx
  ON public.ops_job_photos(source);

COMMENT ON COLUMN public.ops_job_photos.source IS
  'Origin of the upload: staff for admin/tech uploads, customer for public booking uploads.';
COMMENT ON COLUMN public.ops_job_photos.uploaded_by_label IS
  'Display label for who submitted the photo, such as Customer.';
COMMENT ON COLUMN public.ops_job_photos.original_filename IS
  'Original browser-provided filename when available.';
