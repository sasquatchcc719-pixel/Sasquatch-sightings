CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_logs_unique_missed_call_auto_reply
  ON public.sms_logs (message_type)
  WHERE message_type LIKE 'missed_call_auto_reply:%';
