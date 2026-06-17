/**
 * Public Jobs API - Cross-Origin Endpoint for Angular Website
 * Returns published jobs with optional city/area filtering
 * Includes CORS headers for sasquatchcarpet.com access
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'
import { isUnknownCity } from '@/lib/geocode'

// Define service area boundaries (approximate center points and radius in degrees)
const SERVICE_AREAS: Record<
  string,
  {
    lat: number
    lng: number
    radius: number
    neighborhoodKeywords?: string[]
    cityFallback?: string
  }
> = {
  // Tri-Lakes / North
  monument: {
    lat: 39.0917,
    lng: -104.8727,
    radius: 0.08,
    cityFallback: 'Monument',
  },
  woodmoor: {
    lat: 39.1003,
    lng: -104.8544,
    radius: 0.05,
    neighborhoodKeywords: ['Woodmoor'],
    cityFallback: 'Monument',
  },
  gleneagle: {
    lat: 39.0442,
    lng: -104.8322,
    radius: 0.05,
    neighborhoodKeywords: ['Gleneagle'],
  },
  'palmer-lake': {
    lat: 39.1214,
    lng: -104.9119,
    radius: 0.04,
    cityFallback: 'Palmer Lake',
  },
  larkspur: {
    lat: 39.235,
    lng: -104.89,
    radius: 0.1,
    cityFallback: 'Larkspur',
  },
  'castle-rock': {
    lat: 39.3722,
    lng: -104.8561,
    radius: 0.1,
    cityFallback: 'Castle Rock',
  },

  // Colorado Springs — whole city fallback
  'colorado-springs': {
    lat: 38.8339,
    lng: -104.8214,
    radius: 0.2,
    cityFallback: 'Colorado Springs',
  },

  // Colorado Springs neighborhoods
  'flying-horse': {
    lat: 39.0075,
    lng: -104.7597,
    radius: 0.05,
    neighborhoodKeywords: ['Flying Horse'],
  },
  rockrimmon: {
    lat: 38.9033,
    lng: -104.8736,
    radius: 0.04,
    neighborhoodKeywords: ['Rockrimmon'],
  },
  'kissing-camels': {
    lat: 38.89,
    lng: -104.9,
    radius: 0.03,
    neighborhoodKeywords: ['Kissing Camels'],
  },
  'mountain-shadows': {
    lat: 38.875,
    lng: -104.89,
    radius: 0.04,
    neighborhoodKeywords: ['Mountain Shadows'],
  },
  briargate: {
    lat: 38.95,
    lng: -104.78,
    radius: 0.06,
    neighborhoodKeywords: ['Briargate', 'Northgate'],
  },
  'briargate-northgate': {
    lat: 38.95,
    lng: -104.78,
    radius: 0.06,
    neighborhoodKeywords: ['Briargate', 'Northgate'],
  },
  'cordera-wolf-ranch': {
    lat: 38.96,
    lng: -104.74,
    radius: 0.05,
    neighborhoodKeywords: ['Cordera', 'Wolf Ranch', 'Pine Creek'],
  },
  'black-forest': {
    lat: 39.0167,
    lng: -104.6333,
    radius: 0.12,
    neighborhoodKeywords: ['Black Forest'],
    cityFallback: 'Black Forest',
  },
}

// CORS headers for cross-origin access
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // In production, restrict to sasquatchcarpet.com
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const area = searchParams.get('area')?.toLowerCase()
    const limit = Math.min(parseInt(searchParams.get('limit') || '6'), 100)

    const supabase = await createClient()

    // Base query for published jobs
    let query = supabase
      .from('jobs')
      .select(
        `
        id,
        ai_description,
        image_url,
        city,
        neighborhood,
        gps_fuzzy_lat,
        gps_fuzzy_lng,
        published_at,
        slug,
        service:services(name, slug)
      `,
      )
      .eq('status', 'published')
      .order('published_at', { ascending: false })

    const { data: jobs, error } = await query.limit(limit * 3) // Fetch extra for filtering

    if (error) {
      console.error('Error fetching public jobs:', error)
      return NextResponse.json(
        { error: 'Failed to fetch jobs' },
        { status: 500, headers: corsHeaders },
      )
    }

    // Filter by area if specified
    let filteredJobs = jobs || []

    if (area && SERVICE_AREAS[area]) {
      const areaConfig = SERVICE_AREAS[area]
      const allJobs = filteredJobs

      // 1. Try GPS bounding box first
      const gpMatches = allJobs.filter((job) => {
        if (!job.gps_fuzzy_lat || !job.gps_fuzzy_lng) return false
        const latDiff = Math.abs(job.gps_fuzzy_lat - areaConfig.lat)
        const lngDiff = Math.abs(job.gps_fuzzy_lng - areaConfig.lng)
        return latDiff <= areaConfig.radius && lngDiff <= areaConfig.radius
      })

      if (gpMatches.length >= limit) {
        filteredJobs = gpMatches
      } else {
        // 2. Supplement with neighborhood keyword matches
        const keywords = areaConfig.neighborhoodKeywords || []
        const keywordMatches = allJobs.filter((job) => {
          if (gpMatches.includes(job)) return false // already included
          const neighborhood = (job.neighborhood || '').toLowerCase()
          return keywords.some((k) => neighborhood.includes(k.toLowerCase()))
        })

        filteredJobs = [...gpMatches, ...keywordMatches]

        // 3. If still not enough, fall back to city-level jobs
        if (filteredJobs.length < limit && areaConfig.cityFallback) {
          const city = areaConfig.cityFallback.toLowerCase()
          const cityMatches = allJobs.filter((job) => {
            if (filteredJobs.includes(job)) return false
            return (job.city || '').toLowerCase().includes(city)
          })
          filteredJobs = [...filteredJobs, ...cityMatches]
        }
      }
    }

    // Deduplicate by image_url so the carousel doesn't show the same photo repeatedly
    const seenImages = new Set<string>()
    filteredJobs = filteredJobs.filter((job) => {
      if (!job.image_url) return true
      if (seenImages.has(job.image_url)) return false
      seenImages.add(job.image_url)
      return true
    })

    // Limit results
    filteredJobs = filteredJobs.slice(0, limit)

    // Format for public consumption (never expose "Unknown" for SEO/trust)
    const displayCity = (city: string | null | undefined) =>
      isUnknownCity(city) ? 'Colorado' : (city ?? 'Colorado')
    const formattedJobs = filteredJobs.map((job) => {
      const city = displayCity(job.city)
      return {
        id: job.id,
        title: `${(job.service as any)?.name || 'Carpet Cleaning'} in ${city}`,
        description:
          job.ai_description?.slice(0, 200) +
          (job.ai_description?.length > 200 ? '...' : ''),
        image_url: job.image_url,
        city,
        neighborhood: job.neighborhood,
        published_at: job.published_at,
        slug: job.slug,
        service_type: (job.service as any)?.name,
        detail_url: `/work/${city.toLowerCase().replace(/\s+/g, '-')}/${job.slug}`,
      }
    })

    return NextResponse.json(
      {
        success: true,
        count: formattedJobs.length,
        area: area || 'all',
        jobs: formattedJobs,
      },
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
        },
      },
    )
  } catch (error) {
    console.error('Public jobs API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders },
    )
  }
}
