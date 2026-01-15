-- ============================================
-- SASQUATCH JOB PINNER - DATABASE SCHEMA
-- Phase 1: Foundation Tables
-- ============================================

-- SERVICES TABLE (Lookup table - extensible without code changes)
CREATE TABLE services (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- JOBS TABLE (Core data)
CREATE TABLE jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  service_id UUID REFERENCES services(id) NOT NULL,
  image_url TEXT NOT NULL,
  image_filename TEXT NOT NULL,
  gps_lat DECIMAL(10, 7),
  gps_lng DECIMAL(10, 7),
  gps_fuzzy_lat DECIMAL(10, 7),
  gps_fuzzy_lng DECIMAL(10, 7),
  city TEXT,
  neighborhood TEXT,
  raw_voice_input TEXT,
  ai_description TEXT,
  slug TEXT UNIQUE,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at TIMESTAMPTZ DEFAULT now(),
  published_at TIMESTAMPTZ
);

-- INDEXES (Performance for public queries)
CREATE INDEX idx_jobs_published ON jobs(status, created_at DESC) WHERE status = 'published';
CREATE INDEX idx_jobs_city ON jobs(city) WHERE status = 'published';

-- SIGHTINGS TABLE (Sasquatch truck contest submissions)
CREATE TABLE sightings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  image_url TEXT NOT NULL,
  image_filename TEXT NOT NULL,
  gps_lat DECIMAL(10, 7),
  gps_lng DECIMAL(10, 7),
  full_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  email TEXT NOT NULL,
  zip_code TEXT,
  social_platform TEXT CHECK (social_platform IN ('facebook', 'instagram')),
  social_link TEXT,
  coupon_code TEXT UNIQUE NOT NULL,
  contest_eligible BOOLEAN DEFAULT false,
  coupon_redeemed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- INDEXES (Performance for public queries)
CREATE INDEX idx_sightings_created ON sightings(created_at DESC);

-- ============================================
-- SEED DATA: Service Types
-- ============================================

INSERT INTO services (name, slug) VALUES
  ('Standard Carpet Cleaning', 'standard-carpet-cleaning'),
  ('Urine Treatment', 'urine-treatment'),
  ('Deep Carpet Restoration', 'deep-carpet-restoration'),
  ('Rug Cleaning', 'rug-cleaning'),
  ('Tile & Grout Cleaning', 'tile-grout-cleaning'),
  ('Leather Furniture Cleaning', 'leather-furniture-cleaning'),
  ('Fabric Furniture Cleaning', 'fabric-furniture-cleaning'),
  ('Auto Scrubbing (Hard Floors)', 'auto-scrubbing-hard-floors'),
  ('Strip & Wax (VCT Floors)', 'strip-wax-vct-floors'),
  ('Low Moisture Encapsulation', 'low-moisture-encapsulation');

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sightings ENABLE ROW LEVEL SECURITY;

-- SERVICES: Anyone can read (needed for dropdowns)
CREATE POLICY "Services are publicly readable"
  ON services FOR SELECT
  USING (true);

-- JOBS: Public can only see published jobs
CREATE POLICY "Published jobs are publicly readable"
  ON jobs FOR SELECT
  USING (status = 'published');

-- JOBS: Authenticated users can do everything (admin)
CREATE POLICY "Authenticated users have full access to jobs"
  ON jobs FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- SIGHTINGS: Public can read all sightings (for map display)
CREATE POLICY "Sightings are publicly readable"
  ON sightings FOR SELECT
  USING (true);

-- SIGHTINGS: Anyone can insert (public contest submissions)
CREATE POLICY "Anyone can submit sightings"
  ON sightings FOR INSERT
  WITH CHECK (true);

-- SIGHTINGS: Authenticated users can update/delete (admin)
CREATE POLICY "Authenticated users can manage sightings"
  ON sightings FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================
-- STORAGE BUCKET (For images)
-- ============================================

-- Create storage bucket for job images
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-images', 'job-images', true);

-- Allow authenticated users to upload
CREATE POLICY "Authenticated users can upload images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'job-images' AND auth.role() = 'authenticated');

-- Allow authenticated users to delete images
CREATE POLICY "Authenticated users can delete images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'job-images' AND auth.role() = 'authenticated');

-- Allow public to view images
CREATE POLICY "Public can view job images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'job-images');

-- Create storage bucket for sighting images
INSERT INTO storage.buckets (id, name, public)
VALUES ('sighting-images', 'sighting-images', true);

-- Allow anyone to upload sighting images (public contest)
CREATE POLICY "Anyone can upload sighting images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'sighting-images');

-- Allow authenticated users to delete sighting images
CREATE POLICY "Authenticated users can delete sighting images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'sighting-images' AND auth.role() = 'authenticated');

-- Allow public to view sighting images
CREATE POLICY "Public can view sighting images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'sighting-images');
