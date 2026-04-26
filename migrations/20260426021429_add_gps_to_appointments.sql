-- Add GPS coordinates to ops_appointments for accurate job location tracking
-- Monument jobs were showing wrong coordinates due to geocoding; this allows
-- capturing real GPS when on-site

ALTER TABLE ops_appointments
ADD COLUMN IF NOT EXISTS gps_lat DECIMAL(10, 7),
ADD COLUMN IF NOT EXISTS gps_lng DECIMAL(11, 7);

COMMENT ON COLUMN ops_appointments.gps_lat IS 'GPS latitude captured on-site (more accurate than geocoded address)';
COMMENT ON COLUMN ops_appointments.gps_lng IS 'GPS longitude captured on-site (more accurate than geocoded address)';
