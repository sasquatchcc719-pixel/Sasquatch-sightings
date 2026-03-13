import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech', 'marketing'])

    const { searchParams } = new URL(request.url)
    const address = searchParams.get('address')

    if (!address) {
      return new NextResponse('address is required', { status: 400 })
    }

    const key = process.env.GOOGLE_MAPS_STREETVIEW_KEY
    if (!key) {
      return new NextResponse('Street View not configured', { status: 503 })
    }

    const params = new URLSearchParams({
      size: '640x360',
      location: address,
      key,
      return_error_code: 'true',
      source: 'outdoor',
    })

    const googleUrl = `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`
    const response = await fetch(googleUrl, { cache: 'no-store' })

    if (!response.ok) {
      return new NextResponse(null, { status: response.status })
    }

    const imageBuffer = await response.arrayBuffer()

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': response.headers.get('Content-Type') ?? 'image/jpeg',
        // Cache aggressively — street view of an address rarely changes
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      },
    })
  } catch (error) {
    console.error('[streetview] Error:', error)
    return new NextResponse('Failed to fetch street view', { status: 500 })
  }
}
