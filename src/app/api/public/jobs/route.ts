/**
 * Public Jobs API - Cross-Origin Endpoint for Angular Website
 * Returns published jobs with optional city/area filtering
 * Includes CORS headers for sasquatchcarpet.com access
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'

// Define service area boundaries (approximate center points and radius in degrees)
const SERVICE_AREAS: Record<
  string,
  { lat: number; lng: number; radius: number }
> = {
  monument: { lat: 39.0917, lng: -104.8727, radius: 0.08 },
  'black-forest': { lat: 39.0167, lng: -104.6333, radius: 0.12 },
  'flying-horse': { lat: 39.0075, lng: -104.7597, radius: 0.05 },
  woodmoor: { lat: 39.1003, lng: -104.8544, radius: 0.05 },
  gleneagle: { lat: 39.0442, lng: -104.8322, radius: 0.05 },
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
    const limit = Math.min(parseInt(searchParams.get('limit') || '6'), 20)

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
      filteredJobs = filteredJobs.filter((job) => {
        if (!job.gps_fuzzy_lat || !job.gps_fuzzy_lng) return false
        const latDiff = Math.abs(job.gps_fuzzy_lat - areaConfig.lat)
        const lngDiff = Math.abs(job.gps_fuzzy_lng - areaConfig.lng)
        return latDiff <= areaConfig.radius && lngDiff <= areaConfig.radius
      })
    }

    // Limit results
    filteredJobs = filteredJobs.slice(0, limit)

    // Format for public consumption
    const formattedJobs = filteredJobs.map((job) => ({
      id: job.id,
      title: `${(job.service as any)?.name || 'Carpet Cleaning'} in ${job.city || 'Colorado'}`,
      description:
        job.ai_description?.slice(0, 200) +
        (job.ai_description?.length > 200 ? '...' : ''),
      image_url: job.image_url,
      city: job.city,
      neighborhood: job.neighborhood,
      published_at: job.published_at,
      slug: job.slug,
      service_type: (job.service as any)?.name,
      detail_url: `/work/${job.city?.toLowerCase().replace(/\s+/g, '-')}/${job.slug}`,
    }))

    return NextResponse.json(
      {
        success: true,
        count: formattedJobs.length,
        area: area || 'all',
        jobs: formattedJobs,
      },
      { status: 200, headers: corsHeaders },
    )
  } catch (error) {
    console.error('Public jobs API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders },
    )
  }
}
