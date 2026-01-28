-- Create revenue_entries table for tracking revenue without job posts
CREATE TABLE IF NOT EXISTS revenue_entries (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  invoice_amount DECIMAL(10,2) NOT NULL,
  hours_worked DECIMAL(4,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE revenue_entries ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can read own entries"
  ON revenue_entries
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own entries"
  ON revenue_entries
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own entries"
  ON revenue_entries
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own entries"
  ON revenue_entries
  FOR DELETE
  USING (auth.uid() = user_id);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_revenue_entries_user_date ON revenue_entries(user_id, entry_date DESC);
