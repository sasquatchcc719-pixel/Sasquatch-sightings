-- Multiple length × width pairs per line item (commercial sqft takeoffs).
-- When present, quantity is derived from the sum of segment areas (or linear runs).

ALTER TABLE ops_appointment_line_items
  ADD COLUMN IF NOT EXISTS area_segments jsonb DEFAULT NULL;

COMMENT ON COLUMN ops_appointment_line_items.area_segments IS
  'JSON array of {"length": number, "width": number} in feet. For per_sqft, total qty = sum(length*width). For linear units, total qty = sum(length) per segment (width optional). When null, use length_value/width_value as a single rectangle.';
