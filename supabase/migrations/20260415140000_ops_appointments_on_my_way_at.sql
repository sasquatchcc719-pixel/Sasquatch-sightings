-- Wall-clock start when tech taps "On My Way"; with completed_at yields actual job duration for stats.
ALTER TABLE ops_appointments
  ADD COLUMN IF NOT EXISTS on_my_way_at TIMESTAMPTZ;

COMMENT ON COLUMN ops_appointments.on_my_way_at IS 'First time status became on_my_way; utilization hours = completed_at - on_my_way_at when both set.';
