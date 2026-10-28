-- Secrets are provisioned into Vault and Vercel outside version control.
-- A missing notification credential must never prevent a legitimate booking.
CREATE OR REPLACE FUNCTION public.notify_appointment_booked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  webhook_secret text;
BEGIN
  IF NEW.source = 'integration_test' OR NEW.kind = 'estimate' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO webhook_secret
    FROM vault.decrypted_secrets
    WHERE name = 'sightings_appointment_webhook_secret';

    IF webhook_secret IS NULL OR webhook_secret = '' THEN
      RAISE WARNING 'Booking notification credential is not configured';
      RETURN NEW;
    END IF;

    -- Never forward the credential to a caller-controlled configuration URL.
    PERFORM net.http_post(
      url := 'https://sightings.sasquatchcarpet.com/api/webhooks/appointment-booked',
      body := jsonb_build_object('type', 'INSERT', 'record', jsonb_build_object('id', NEW.id)),
      params := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', webhook_secret),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Booking notification failed for appointment %, SQLSTATE %', NEW.id, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_appointment_booked() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_appointment_booked() TO service_role;
