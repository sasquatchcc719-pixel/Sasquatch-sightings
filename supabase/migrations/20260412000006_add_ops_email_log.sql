CREATE TABLE IF NOT EXISTS ops_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid REFERENCES ops_appointments(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES ops_customers(id) ON DELETE SET NULL,
  template_key text NOT NULL,
  to_email text NOT NULL,
  subject text,
  resend_id text,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error_message text,
  sent_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_email_log_appointment_id_idx ON ops_email_log(appointment_id);
CREATE INDEX IF NOT EXISTS ops_email_log_sent_at_idx ON ops_email_log(sent_at DESC);
