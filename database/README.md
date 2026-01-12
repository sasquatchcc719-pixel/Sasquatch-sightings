# Database Schema

This directory contains the SQL schema for the Sasquatch Job Pinner database.

## Applying the Schema

### Option 1: Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy the entire contents of `schema.sql`
5. Paste into the editor
6. Click **Run** (or press Cmd/Ctrl + Enter)

**Dashboard URL:** https://supabase.com/dashboard/project/zoabgmsbvzcqpzlrhsfz/sql

### Option 2: Supabase CLI

```bash
# Install Supabase CLI (if not already installed)
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref zoabgmsbvzcqpzlrhsfz

# Run the migration
supabase db push
```

## Schema Overview

### Tables

#### `services`
- **Purpose:** Lookup table for service types
- **Extensible:** Add new services without code changes
- **Access:** Publicly readable (for dropdowns)

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Display name (e.g., "Standard Carpet Cleaning") |
| slug | TEXT | URL-safe slug (e.g., "standard-carpet-cleaning") |
| created_at | TIMESTAMPTZ | Creation timestamp |

#### `jobs`
- **Purpose:** Core table storing job records
- **Access:** Authenticated users (full), Public (published only)

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| service_id | UUID | Foreign key to services table |
| image_url | TEXT | Public URL to job image |
| image_filename | TEXT | Original filename |
| gps_lat | DECIMAL(10, 7) | Actual GPS latitude (private) |
| gps_lng | DECIMAL(10, 7) | Actual GPS longitude (private) |
| gps_fuzzy_lat | DECIMAL(10, 7) | Fuzzed latitude for public display |
| gps_fuzzy_lng | DECIMAL(10, 7) | Fuzzed longitude for public display |
| city | TEXT | City name (from geocoding) |
| neighborhood | TEXT | Neighborhood name (from geocoding) |
| raw_voice_input | TEXT | Original voice note transcription |
| ai_description | TEXT | AI-generated description |
| slug | TEXT | URL slug for SEO page |
| status | TEXT | 'draft' or 'published' |
| created_at | TIMESTAMPTZ | Creation timestamp |
| published_at | TIMESTAMPTZ | Publication timestamp |

### Indexes

- `idx_jobs_published`: Optimized for public queries (status + created_at)
- `idx_jobs_city`: Optimized for city-based filtering

### Row Level Security (RLS)

#### Services Table
- ✅ **Public:** Can read all services
- ❌ **Public:** Cannot create/update/delete

#### Jobs Table
- ✅ **Public:** Can read published jobs only
- ✅ **Authenticated:** Full CRUD access (admin)
- ❌ **Public:** Cannot see draft jobs

### Storage

#### `job-images` Bucket
- **Public:** true (images are publicly accessible via URL)
- **Upload:** Authenticated users only
- **Read:** Public

## Seed Data

The schema includes 10 service types:
1. Standard Carpet Cleaning
2. Urine Treatment
3. Deep Carpet Restoration
4. Rug Cleaning
5. Tile & Grout Cleaning
6. Leather Furniture Cleaning
7. Fabric Furniture Cleaning
8. Auto Scrubbing (Hard Floors)
9. Strip & Wax (VCT Floors)
10. Low Moisture Encapsulation

## Verifying Installation

After running the schema, verify:

```sql
-- Check tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('services', 'jobs');

-- Check services are seeded
SELECT COUNT(*) FROM services;  -- Should return 10

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('services', 'jobs');

-- Check storage bucket
SELECT * FROM storage.buckets WHERE id = 'job-images';
```

## Next Steps

After applying the schema:
1. ✅ Verify tables and RLS policies
2. Generate TypeScript types (see below)
3. Test authentication flow
4. Start building Phase 2 features

## Generating TypeScript Types

To generate TypeScript types from your Supabase schema:

```bash
# Using Supabase CLI
supabase gen types typescript --project-id zoabgmsbvzcqpzlrhsfz > src/types/supabase.ts
```

Or manually from the dashboard:
1. Go to **Settings** > **API**
2. Scroll to **Project API Keys**
3. Copy the TypeScript type definitions
