/**
 * Dynamic Sitemap Generation for Sasquatch Sightings
 * Generates sitemap.xml for SEO with all job pages and sighting share pages
 * Per Next.js App Router: Export default function returning MetadataRoute.Sitemap
 */

import { MetadataRoute } from 'next'
import { createClient } from '@/supabase/server'
import { isUnknownCity } from '@/lib/geocode'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://sightings.sasquatchcarpet.com'

  // Create Supabase client
  const supabase = await createClient()

  // Fetch all published jobs
  const { data: jobs } = await supabase
    .from('jobs')
    .select('slug, city, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })

  // Fetch all sightings
  const { data: sightings } = await supabase
    .from('sightings')
    .select('id, created_at')
    .order('created_at', { ascending: false })

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/sightings`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/book`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
  ]

  // Job pages (dynamic) — skip unknown city/slug jobs entirely.
  // Advertise the CANONICAL www proxy URLs (www.sasquatchcarpet.com/sightings/*),
  // matching the canonical tag on the pages — cross-host sitemap entries are
  // valid because both properties are verified in Search Console. Previously
  // this sitemap pushed the duplicate subdomain copies, splitting signals.
  const jobPages: MetadataRoute.Sitemap = (jobs || [])
    .filter((job) => !isUnknownCity(job.city) && !job.slug?.includes('unknown'))
    .map((job) => {
      const cityForSlug = job.city ?? 'Colorado'
      const citySlug = cityForSlug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')

      return {
        url: `https://www.sasquatchcarpet.com/sightings/${citySlug}/${job.slug}`,
        lastModified: new Date(job.published_at),
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      }
    })

  // Sighting share pages (dynamic)
  const sightingPages: MetadataRoute.Sitemap = (sightings || []).map(
    (sighting) => ({
      url: `${baseUrl}/sightings/share/${sighting.id}`,
      lastModified: new Date(sighting.created_at),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }),
  )

  // Combine all pages
  return [...staticPages, ...jobPages, ...sightingPages]
}

// Revalidate every hour (3600 seconds)
export const revalidate = 3600
