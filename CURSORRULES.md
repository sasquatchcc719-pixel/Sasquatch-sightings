# SASQUATCH SIGHTINGS — PROJECT RULES
> These rules govern ALL code decisions. No exceptions.

---

## 🚨 CORE RULES

### RULE 1: No invention. Only proven patterns.
If it's not documented in the official docs of Next.js, Supabase, Mapbox, or the libraries in `package.json`, we don't do it. No clever workarounds. No "I think this should work." If you can't link to documentation supporting the approach, don't use it.

### RULE 2: Stay inside the structure.
All code goes under `src/`. Auth uses the existing Supabase auth flow in `src/app/auth/`. Admin routes use `src/app/admin/`. Partner routes use `src/app/partners/`. We extend the structure, we don't restructure it.

### RULE 3: One feature at a time.
Complete and test each task before starting the next. No parallel work. No "I'll also add this while I'm here." Finish what was asked, confirm it works, then stop.

### RULE 4: If it breaks, we stop.
No patching around bugs to keep moving. If something breaks, diagnose the root cause and fix it properly. No band-aids. No "temporary" workarounds that become permanent.

### RULE 5: Copy-paste from docs, not memory.
When implementing Mapbox, Nominatim, Sharp, or any library, use exact syntax from official documentation. Do not generate API calls from training data. If unsure, say so and ask for documentation.

### RULE 6: Human approves before merge.
No code goes into `main` without Charles reviewing it. Propose changes, explain what they do, wait for approval.

### RULE 7: All work happens on feature branches.
Never code directly on `main`. Every task gets its own branch. If a branch gets messy, delete it and start fresh. Main stays clean.

### RULE 8: Branch naming convention.
Use: `feature/[phase]-[short-description]`

Examples:
- `feature/p1-database-schema`
- `feature/p2-upload-form`
- `feature/partner-portal`
- `feature/contest-viral-loop`

---

## 📋 PROJECT CONTEXT

This is a **"Neighborhood Authority Engine" PWA** for Sasquatch Carpet Cleaning with two main features:

1. **Job Pinner** — Converts field photos + voice notes into local SEO pages with map pins
2. **Sightings Contest** — Truck wrap QR code leads to contest entry, coupon distribution, and social sharing viral loop
3. **Partner Portal** — Referral program for business partners (realtors, etc.) who earn credits for sending clients

---

## 🛠 THE STACK

| Technology | Purpose |
|------------|---------|
| Next.js 16 (App Router) | Framework — already configured |
| Supabase | Auth + Database + Storage |
| Mapbox GL JS | Public map view |
| OpenStreetMap/Nominatim | Backend geocoding (NOT Mapbox due to TOS) |
| Sharp | Server-side image optimization |
| browser-image-compression | Client-side compression before upload |
| HousecallPro | External booking system integration |

---

## 📁 KEY DIRECTORIES

```
src/
├── app/
│   ├── admin/              # Admin dashboard (requires auth, role: admin)
│   │   ├── jobs/[id]/      # Job editor
│   │   ├── sightings/      # Contest entries management
│   │   ├── partners/       # Partner & referral management
│   │   └── tools/combine/  # Before/After image combiner
│   ├── partners/           # Partner portal (requires auth, role: partner)
│   │   └── register/       # Partner registration
│   ├── sightings/          # Public contest entry form
│   │   └── share/[id]/     # Public sighting share pages
│   ├── work/[city]/[slug]/ # Public SEO job pages
│   ├── preferred-partners/ # Public partners listing
│   ├── api/                # Server actions
│   └── auth/               # Authentication pages
├── components/
│   ├── admin/              # Admin UI components
│   ├── partners/           # Partner dashboard components
│   └── public/             # Map view, job page layout
└── lib/                    # Utilities (geocode, seo-filename, auth, etc.)
```

---

## 🌐 WEBSITE BOOKING & CATALOG PRICES (where to look)

**Problem:** Pricing and minimums for **sasquatch.com** online booking are split between this app (API + database) and the Angular site repo. File names alone are easy to lose.

| What | Where |
|------|--------|
| Public service list for the widget | `src/app/api/public/services/route.ts` → reads `service_catalog_items` |
| Create booked job from widget | `src/app/api/public/appointments/route.ts` |
| Pre-Vacuuming **$10** DB fix | `supabase/migrations/20260413120000_fix_pre_vacuuming_catalog_price.sql` |
| Migration index (searchable) | `supabase/migrations/README.md` |
| $150 minimum + Pre-Vacuum UI override | `sasquatch.com-client` → `booking-widget.component.ts` (sibling repo, not this one) |

**Keywords to search in this repo:** `pre-vacuuming`, `service_catalog_items`, `public/services`, `BOOKING_API_SECRET`, `minimumJobTotal`.

### Cursor prompt (paste in chat when you want the assistant to load context)

```
Open and follow Sasquatch Sightings: supabase/migrations/README.md and CURSORRULES.md section "WEBSITE BOOKING & CATALOG PRICES". Use those paths for booking, Pre-Vacuuming $10, and $150 minimum work.
```

---

## 🗄 DATABASE TABLES

### Core Tables
| Table | Purpose |
|-------|---------|
| `service_catalog_items` | Ops + **public booking** prices (`base_price`), categories, durations — see migrations README |
| `services` | Lookup table of service types |
| `jobs` | Job records (image, location, voice input, AI description, status) |
| `sightings` | Contest entries (photo, contact info, coupon, GPS, share_verified) |

### Partner Portal Tables
| Table | Purpose |
|-------|---------|
| `partners` | Partner accounts (name, company, email, credit_balance, backlink status) |
| `referrals` | Referral records (client info, status: pending/booked/converted, credit amount) |

---

## 🔐 AUTHENTICATION & ROLES

### Roles
- **admin** — Full access to `/admin/*`, can manage jobs, contest entries, partners
- **partner** — Access to `/partners` only, can submit referrals, view their balance

### Route Protection
| Route | Access |
|-------|--------|
| `/admin/*` | Admins only |
| `/partners` | Partners only |
| `/partners/register` | Public |
| `/sightings` | Public |
| `/work/*` | Public |

### Legacy Admin Handling
Users authenticated before the Partner Portal (no record in `partners` table) are treated as "legacy admins" and redirected to `/admin`.

---

## 🔄 DATA FLOWS

### Job Submission Flow
```
Photo + voice → EXIF extraction → compression → upload → 
geocode (Nominatim) → Sharp optimization → Supabase storage → 
draft job record → template description → human review → publish → 
public map + SEO page
```

### Contest Entry Flow
```
User scans QR → lands on /sightings → optional photo + contact info →
GPS extraction → reverse geocode → coupon generated → 
viral loop (share on social) → verify checkbox → admin review
```

### Partner Referral Flow
```
Partner submits referral → status: pending → 
admin books job → status: booked → 
job completed → status: converted → $25 credit added →
partner can cash in for free cleaning
```

---

## ⚠️ WHAT NOT TO DO

- ❌ Do NOT use Google Maps API (cost)
- ❌ Do NOT use Mapbox for geocoding storage (TOS violation)
- ❌ Do NOT auto-publish jobs (human review required)
- ❌ Do NOT restructure the auth system
- ❌ Do NOT add packages without explicit approval
- ❌ Do NOT create files outside the established structure
- ❌ Do NOT compress images before extracting EXIF data (compression strips metadata)
- ❌ Do NOT work directly on `main` branch

---

## 🔑 ENVIRONMENT VARIABLES

Required in `.env.local` and Vercel:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_MAPBOX_TOKEN=
ZAPIER_WEBHOOK_URL=              # For job submissions
ZAPIER_SIGHTINGS_WEBHOOK_URL=    # For contest entries with photos
```

---

## 📊 INTEGRATIONS

| Service | Purpose | Trigger |
|---------|---------|---------|
| Zapier (Jobs) | Post to Google Business Profile | New job published |
| Zapier (Sightings) | Social media posting | Contest entry with photo |
| HousecallPro | Booking system | Partner "Book for Client" button |
| Google Analytics | Traffic tracking | All pages (GA4: G-RWTGVVX5RK) |

---

*Last updated: January 2026*
