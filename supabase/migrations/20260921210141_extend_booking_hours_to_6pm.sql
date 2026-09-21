-- Keep the live booking window open through 6:00 PM for every existing
-- availability template that still uses the previous 5:00 PM cutoff.
UPDATE public.availability_templates
SET end_time = '18:00:00'
WHERE end_time = '17:00:00';
