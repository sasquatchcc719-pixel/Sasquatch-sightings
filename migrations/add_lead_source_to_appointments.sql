-- Add lead_source column to ops_appointments
-- Tracks how the customer heard about Sasquatch Carpet Cleaning

ALTER TABLE ops_appointments ADD COLUMN IF NOT EXISTS lead_source text;
