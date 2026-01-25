-- Add sighting_id foreign key to leads table for proper cascade deletes
-- This creates a direct relationship between contest entries (sightings) and their leads

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS sighting_id UUID REFERENCES sightings(id) ON DELETE CASCADE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_leads_sighting_id ON leads(sighting_id);

-- Add comment for documentation
COMMENT ON COLUMN leads.sighting_id IS 'Links contest entry leads to their source sighting (for cascade delete)';
