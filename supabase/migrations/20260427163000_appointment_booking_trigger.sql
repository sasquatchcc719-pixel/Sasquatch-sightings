-- Create a trigger to send booking notifications for all new appointments
-- This uses Supabase's pg_net extension to call the webhook

-- Enable pg_net extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create function to send booking notification
CREATE OR REPLACE FUNCTION notify_appointment_booked()
RETURNS TRIGGER AS $$
DECLARE
  webhook_url TEXT;
BEGIN
  -- Get the webhook URL from environment (you'll set this in Supabase dashboard)
  webhook_url := current_setting('app.settings.webhook_url', true);

  -- If webhook URL is not set, use the production URL
  IF webhook_url IS NULL OR webhook_url = '' THEN
    webhook_url := 'https://sasquatch-sightings.vercel.app/api/webhooks/appointment-booked';
  END IF;

  -- Send async HTTP POST request to webhook
  PERFORM net.http_post(
    url := webhook_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := json_build_object(
      'type', 'INSERT',
      'record', json_build_object('id', NEW.id)
    )::text
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger that fires after INSERT on ops_appointments
DROP TRIGGER IF EXISTS appointment_booked_trigger ON ops_appointments;
CREATE TRIGGER appointment_booked_trigger
  AFTER INSERT ON ops_appointments
  FOR EACH ROW
  EXECUTE FUNCTION notify_appointment_booked();

-- Add comment
COMMENT ON FUNCTION notify_appointment_booked() IS 'Sends Telegram notification when new appointments are created';
