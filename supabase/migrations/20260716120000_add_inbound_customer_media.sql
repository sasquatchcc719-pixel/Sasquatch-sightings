-- Durable inbound MMS media. Photos belong to the conversation/customer first
-- and are copied into ops_job_photos only after a staff classification action.

CREATE TABLE IF NOT EXISTS public.ops_customer_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.ops_customers(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES public.ops_appointments(id) ON DELETE SET NULL,
  job_photo_id uuid REFERENCES public.ops_job_photos(id) ON DELETE SET NULL,
  sender_phone text NOT NULL,
  business_number text,
  twilio_message_sid text NOT NULL,
  twilio_media_sid text,
  media_index integer NOT NULL CHECK (media_index >= 0),
  source_url text NOT NULL,
  storage_path text,
  content_type text NOT NULL,
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'available', 'failed')),
  category text NOT NULL DEFAULT 'unclassified'
    CHECK (category IN (
      'unclassified',
      'customer_file',
      'estimate',
      'job',
      'preexisting_damage'
    )),
  error_message text,
  classified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (twilio_message_sid, media_index)
);

CREATE INDEX IF NOT EXISTS ops_customer_media_conversation_idx
  ON public.ops_customer_media(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS ops_customer_media_customer_idx
  ON public.ops_customer_media(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ops_customer_media_sender_phone_idx
  ON public.ops_customer_media(sender_phone)
  WHERE customer_id IS NULL;

ALTER TABLE public.ops_customer_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ops_customer_media_staff_read"
  ON public.ops_customer_media
  FOR SELECT
  TO authenticated
  USING (public.app_has_role(ARRAY['owner', 'dispatcher', 'tech', 'marketing']));

CREATE POLICY "ops_customer_media_staff_write"
  ON public.ops_customer_media
  FOR ALL
  TO authenticated
  USING (public.app_has_role(ARRAY['owner', 'dispatcher']))
  WITH CHECK (public.app_has_role(ARRAY['owner', 'dispatcher']));

-- Customer MMS files are private. Server routes create short-lived signed URLs
-- for staff views and copy deliberately selected media into the public job-photo
-- bucket used by appointment and invoice screens.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('customer-media', 'customer-media', false, 15728640)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

-- When an unknown texter later becomes a customer, attach all of their retained
-- MMS history by normalized US phone number. This also covers phone corrections.
CREATE OR REPLACE FUNCTION public.link_customer_media_by_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  customer_digits text;
BEGIN
  customer_digits := right(regexp_replace(COALESCE(NEW.phone, ''), '\D', '', 'g'), 10);
  IF length(customer_digits) = 10 THEN
    UPDATE public.ops_customer_media
    SET customer_id = NEW.id
    WHERE customer_id IS NULL
      AND right(regexp_replace(sender_phone, '\D', '', 'g'), 10) = customer_digits;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS link_customer_media_after_customer_phone_change
  ON public.ops_customers;
CREATE TRIGGER link_customer_media_after_customer_phone_change
AFTER INSERT OR UPDATE OF phone ON public.ops_customers
FOR EACH ROW
EXECUTE FUNCTION public.link_customer_media_by_phone();

COMMENT ON TABLE public.ops_customer_media IS
  'Private customer media received through messaging, retained before optional job/invoice classification.';
COMMENT ON COLUMN public.ops_customer_media.job_photo_id IS
  'Public ops_job_photos copy created by an intentional attach-to-job action.';
