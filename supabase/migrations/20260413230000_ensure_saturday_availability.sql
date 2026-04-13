-- Ensure Saturday (day_of_week = 6) has an active availability template.
-- Only inserts if no Saturday row exists yet.
INSERT INTO availability_templates (day_of_week, start_time, end_time, slot_interval_minutes, is_active)
SELECT 6, '09:00', '17:00', 30, true
WHERE NOT EXISTS (
  SELECT 1 FROM availability_templates WHERE day_of_week = 6
);

-- If a Saturday row exists but is inactive, activate it.
UPDATE availability_templates
SET is_active = true
WHERE day_of_week = 6 AND is_active = false;
