-- pg_net v0.15 exposes net.http_post(url, body, params, headers, timeout_milliseconds).
-- Passing body as text makes every ops_appointments insert fail from the AFTER INSERT trigger.

CREATE OR REPLACE FUNCTION notify_appointment_booked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  webhook_url TEXT;
BEGIN
  webhook_url := current_setting('app.settings.webhook_url', true);

  IF webhook_url IS NULL OR webhook_url = '' THEN
    webhook_url := 'https://sightings.sasquatchcarpet.com/api/webhooks/appointment-booked';
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := webhook_url,
      body := jsonb_build_object(
        'type', 'INSERT',
        'record', jsonb_build_object('id', NEW.id)
      ),
      params := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 5000
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'notify_appointment_booked failed for appointment %, SQLSTATE %, message: %',
        NEW.id,
        SQLSTATE,
        SQLERRM;
  END;

  RETURN NEW;
END;
$$;
