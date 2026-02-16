
-- Add placard_type column to partners table for vendor configuration
ALTER TABLE partners 
ADD COLUMN IF NOT EXISTS placard_type text DEFAULT 'standard';

-- Update existing rows to have 'standard' if null (though default handles new rows)
UPDATE partners SET placard_type = 'standard' WHERE placard_type IS NULL;

-- Add check constraint to ensure valid values
ALTER TABLE partners 
ADD CONSTRAINT check_placard_type CHECK (placard_type IN ('standard', 'contest'));

-- Comment on column
COMMENT ON COLUMN partners.placard_type IS 'Configuration for which placard is displayed: standard ($20 off) or contest (Enter to Win)';
