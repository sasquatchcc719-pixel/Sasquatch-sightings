-- Tracks AI-generated promotional posts (offers + events)
-- so they never duplicate and Zapier can poll for new ones

CREATE TABLE IF NOT EXISTS promotional_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_type TEXT NOT NULL CHECK (post_type IN ('OFFER', 'EVENT')),
  season TEXT NOT NULL,          -- 'spring', 'summer', 'fall', 'winter'
  year INTEGER NOT NULL,
  quarter INTEGER,               -- 1-4 for EVENT posts
  month INTEGER,                 -- 1-12 for OFFER posts
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT,
  coupon_code TEXT,              -- optional, for OFFER posts
  offer_start_date TEXT,         -- ISO date string
  offer_end_date TEXT,           -- ISO date string
  social_posted_at TIMESTAMPTZ,  -- null = not yet picked up by Zapier
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bucket for promotional images (run in Supabase storage if needed)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('promotional-images', 'promotional-images', true)
-- ON CONFLICT (id) DO NOTHING;
