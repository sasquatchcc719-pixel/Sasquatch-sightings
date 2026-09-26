/**
 * Public Jobs API - Cross-Origin Endpoint for Angular Website
 * Returns published jobs with optional city/area filtering
 * Includes CORS headers for sasquatchcarpet.com access
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'
import { isUnknownCity } from '@/lib/geocode'
import { PUBLIC_AREAS, isInArea } from '@/lib/public-areas'

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

    // Fetch the full published set before area filtering. The old `limit * 3`
    // window only scanned the newest rows table-wide, which made older jobs
    // invisible to every area (Castle Rock returned 1 of its 4 jobs).
    const { data: jobs, error } = await query.limit(500)

    if (error) {
      console.error('Error fetching public jobs:', error)
      return NextResponse.json(
        { error: 'Failed to fetch jobs' },
        { status: 500, headers: corsHeaders },
      )
    }

    // Filter by area if specified
    let filteredJobs = jobs || []

    if (area && !PUBLIC_AREAS[area]) {
      // Unknown area: return nothing rather than the newest jobs from
      // anywhere, which an area page would label as local work.
      filteredJobs = []
    } else if (area) {
      const areaConfig = PUBLIC_AREAS[area]
      const allJobs = filteredJobs

      // 1. Try GPS bounding box first
      const gpMatches = allJobs.filter((job) => isInArea(job, areaConfig))

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
