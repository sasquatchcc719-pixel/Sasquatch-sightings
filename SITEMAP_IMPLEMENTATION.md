# Dynamic Sitemap Implementation

**Date:** January 19, 2026  
**Status:** ✅ Implemented  
**URL:** https://sightings.sasquatchcarpet.com/sitemap.xml

---

## 🎯 Overview

The Sasquatch Sightings app now has a **dynamic sitemap** that automatically updates with new jobs and sightings. This improves:

- **Google indexing** - Search engines discover all pages automatically
- **SEO performance** - Proper priority and change frequency signals
- **Maintenance** - No manual updates needed (fully automated)

---

## 📄 What's Included

### **1. Static Pages**
- **Homepage** (`/`) - Priority: 1.0, Updated: Daily
- **Contest Page** (`/sightings`) - Priority: 0.9, Updated: Daily

### **2. Job Pages** (Dynamic)
- **Path:** `/work/[city]/[slug]`
- **Priority:** 0.8
- **Change Frequency:** Weekly
- **Last Modified:** Based on `published_at` timestamp
- **Example:** `https://sightings.sasquatchcarpet.com/work/monument/pet-urine-removal-monument-2026-01-19-abc123`

### **3. Sighting Share Pages** (Dynamic)
- **Path:** `/sightings/share/[id]`
- **Priority:** 0.6
- **Change Frequency:** Monthly
- **Last Modified:** Based on `created_at` timestamp
- **Example:** `https://sightings.sasquatchcarpet.com/sightings/share/2b052cca-a3d7-4f79-8f5a-6089ee5182bf`

---

## 🛠️ Implementation Details

### **File:** `src/app/sitemap.ts`

**Key Features:**
- Uses Next.js 16 App Router `MetadataRoute.Sitemap` type
- Fetches data from Supabase (jobs and sightings tables)
- Generates city slug from job.city field
- Includes proper lastModified dates
- Revalidates every hour (3600 seconds)

**Code Structure:**
```typescript
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 1. Fetch published jobs from Supabase
  // 2. Fetch all sightings from Supabase
  // 3. Generate static pages array
  // 4. Map jobs to URLs with city/slug format
  // 5. Map sightings to share page URLs
  // 6. Combine and return all URLs
}

export const revalidate = 3600 // Revalidate every hour
```

---

## 🔄 Automatic Updates

### **Revalidation Strategy**

The sitemap automatically updates:
- **Every 1 hour** (via `revalidate = 3600`)
- **On new deployment** (Vercel rebuilds)
- **On-demand** (Google/Bing can request fresh copy)

### **What Triggers Updates**

New URLs appear automatically when:
- ✅ Admin publishes a new job
- ✅ User submits a sighting
- ✅ Existing job/sighting is updated

No manual intervention needed!

---

## 📊 Sitemap Example

### **Sample Output (sitemap.xml):**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <!-- Homepage -->
  <url>
    <loc>https://sightings.sasquatchcarpet.com</loc>
    <lastmod>2026-01-20T00:12:57.493Z</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  
  <!-- Contest Page -->
  <url>
    <loc>https://sightings.sasquatchcarpet.com/sightings</loc>
    <lastmod>2026-01-20T00:12:57.493Z</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  
  <!-- Job Pages (Dynamic) -->
  <url>
    <loc>https://sightings.sasquatchcarpet.com/work/monument/pet-urine-removal-monument-2026-01-19-abc123</loc>
    <lastmod>2026-01-19T18:06:43.308Z</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  
  <!-- Sighting Share Pages (Dynamic) -->
  <url>
    <loc>https://sightings.sasquatchcarpet.com/sightings/share/2b052cca-a3d7-4f79-8f5a-6089ee5182bf</loc>
    <lastmod>2026-01-19T23:36:53.142Z</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
</urlset>
```

---

## 🔍 SEO Benefits

### **1. Faster Indexing**
- Google discovers new pages within hours (instead of days/weeks)
- Proper priority signals help Google prioritize important pages
- Change frequency helps Google determine crawl schedule

### **2. Complete Coverage**
- **Zero missing pages** - All published jobs and sightings included
- **Automatic discovery** - New content appears in sitemap instantly
- **Historical content** - Old sightings/jobs remain discoverable

### **3. Crawl Budget Optimization**
- Priority values guide Google to most important pages first
- Change frequency prevents unnecessary recrawls
- Last modified dates help Google skip unchanged pages

---

## 📈 Priority Hierarchy

| Page Type | Priority | Reasoning |
|-----------|----------|-----------|
| Homepage | 1.0 | Most important - main entry point |
| Contest Page | 0.9 | High value - conversion page |
| Job Pages | 0.8 | Core content - SEO targets |
| Sighting Pages | 0.6 | User-generated - less SEO focus |

---

## 🧪 Testing

### **Local Testing**
```bash
# View sitemap locally
curl http://localhost:3000/sitemap.xml

# Count total URLs
curl -s http://localhost:3000/sitemap.xml | grep -c "<loc>"

# View job pages only
curl -s http://localhost:3000/sitemap.xml | grep "/work/"

# View sighting pages only
curl -s http://localhost:3000/sitemap.xml | grep "/sightings/share/"
```

### **Production Testing**
```bash
# View live sitemap
curl https://sightings.sasquatchcarpet.com/sitemap.xml

# Check sitemap is valid
# Use: https://www.xml-sitemaps.com/validate-xml-sitemap.html
```

---

## 📋 Google Search Console Setup

### **Step 1: Submit Sitemap**

1. Go to [Google Search Console](https://search.google.com/search-console)
2. Select property: `sightings.sasquatchcarpet.com`
3. Click **Sitemaps** in left sidebar
4. Enter: `sitemap.xml`
5. Click **Submit**

### **Step 2: Monitor Status**

Check regularly for:
- ✅ **Discovered URLs** - Should match your total pages
- ✅ **Indexed URLs** - Increases over time
- ⚠️ **Errors** - Fix any issues reported

### **Expected Timeline**
- **Immediate:** Google discovers sitemap
- **24-48 hours:** Google starts crawling URLs
- **1-2 weeks:** Most pages indexed
- **Ongoing:** New pages indexed within 24 hours

---

## 🔧 Maintenance

### **No Action Required**

The sitemap maintains itself automatically:
- ✅ New jobs/sightings appear automatically
- ✅ Deleted content removed automatically (via database queries)
- ✅ Timestamps update based on database values
- ✅ Revalidation happens every hour

### **Monitoring (Optional)**

Occasionally check:
1. **Sitemap accessible:** https://sightings.sasquatchcarpet.com/sitemap.xml
2. **Google Search Console:** Sitemap status and errors
3. **URL count:** Should match published jobs + sightings count

---

## 📊 Expected Impact

### **Short-term (1-2 weeks)**
- ✅ All pages discovered by Google
- ✅ Sitemap shows in Google Search Console
- ✅ Crawl rate increases

### **Medium-term (1-3 months)**
- ✅ Most pages indexed
- ✅ Improved ranking for local queries
- ✅ Sighting pages appear in search results

### **Long-term (3-6 months)**
- ✅ Complete indexing of all historical content
- ✅ Consistent indexing of new content
- ✅ Improved domain authority

---

## 🚨 Troubleshooting

### **Issue: Sitemap returns 404**
**Solution:** Make sure `src/app/sitemap.ts` is deployed

### **Issue: Sitemap is empty**
**Possible causes:**
1. No published jobs in database
2. Supabase connection error
3. RLS policies blocking query

**Debug:**
```typescript
// Add console.log to sitemap.ts
console.log('Jobs:', jobs?.length)
console.log('Sightings:', sightings?.length)
```

### **Issue: URLs not updating**
**Solution:** Wait for revalidation (1 hour) or force redeploy

### **Issue: Google shows errors**
**Common fixes:**
- Verify all URLs are accessible (not 404)
- Check robots.txt isn't blocking pages
- Ensure proper authentication (public pages)

---

## 📚 Resources

- [Next.js Sitemap Docs](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap)
- [Google Sitemap Guidelines](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Sitemap XML Format](https://www.sitemaps.org/protocol.html)

---

## ✅ Checklist

- [x] Create `src/app/sitemap.ts`
- [x] Test locally (verify XML output)
- [x] Deploy to production
- [ ] Submit to Google Search Console
- [ ] Monitor indexing status (weekly)
- [ ] Verify new pages appear automatically

---

**Status:** ✅ Sitemap is live and updating automatically!  
**Next Step:** Submit to Google Search Console for faster indexing.
