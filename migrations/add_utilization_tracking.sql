-- Add revenue and time tracking to jobs table
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS invoice_amount DECIMAL(10,2);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hours_worked DECIMAL(4,2);

-- Create settings table for user goals
CREATE TABLE IF NOT EXISTS settings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  annual_revenue_goal DECIMAL(12,2) DEFAULT 150000,
  available_hours_per_week DECIMAL(4,2) DEFAULT 40,
  work_weeks_per_year INTEGER DEFAULT 48,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on settings table
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own settings
CREATE POLICY "Users can read own settings"
  ON settings
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own settings
CREATE POLICY "Users can insert own settings"
  ON settings
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own settings
CREATE POLICY "Users can update own settings"
  ON settings
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id);
