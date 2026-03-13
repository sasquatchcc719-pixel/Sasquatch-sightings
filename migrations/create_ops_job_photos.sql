-- Job photos attached to ops appointments
-- Stores before/after/general photos uploaded from the invoice detail page

CREATE TABLE IF NOT EXISTS ops_job_photos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  UUID NOT NULL REFERENCES ops_appointments(id) ON DELETE CASCADE,
  storage_path    TEXT NOT NULL,
  public_url      TEXT NOT NULL,
  label           TEXT CHECK (label IN ('before', 'after', 'general')),
  watermarked     BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_job_photos_appointment_id_idx
  ON ops_job_photos(appointment_id);
