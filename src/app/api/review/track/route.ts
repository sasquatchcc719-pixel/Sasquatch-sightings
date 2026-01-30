import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

// Helper to get location from IP
async function getLocationFromIP(ip: string) {
  try {
    const response = await fetch(`https://ipapi.co/${ip}/json/`)
    if (response.ok) {
      const data = await response.json()
      return {
        city: data.city,
        region: data.region,
        country: data.country_name,
      }
    }
  } catch (error) {
    console.error('Failed to get location:', error)
  }
  return { city: null, region: null, country: null }
}

// Helper to detect device type
function getDeviceType(userAgent: string): string {
  if (/mobile|android|iphone/i.test(userAgent)) return 'mobile'
  if (/tablet|ipad/i.test(userAgent)) return 'tablet'
  return 'desktop'
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAdminClient()
    const body = await request.json()
    const { partnerId } = body

    if (!partnerId) {
      return NextResponse.json(
        { error: 'Partner ID is required' },
        { status: 400 },
      )
    }

    // Get request metadata
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'
    const deviceType = getDeviceType(userAgent)

    // Look up the partner and their Google review URL
    const { data: partner, error: partnerError } = await supabase
      .from('partners')
      .select('id, location_name, company_name, google_review_url')
      .eq('id', partnerId)
      .single()

    if (partnerError || !partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    }

    if (!partner.google_review_url) {
      return NextResponse.json(
        { error: 'No review URL configured for this partner' },
        { status: 400 },
      )
    }

    // Get location from IP
    const location = await getLocationFromIP(ip)

    // Track the review station tap
    const { error: tapError } = await supabase
      .from('review_station_taps')
      .insert({
        partner_id: partnerId,
        ip_address: ip,
        user_agent: userAgent,
        device_type: deviceType,
        location_city: location.city,
        location_region: location.region,
        location_country: location.country,
      })

    if (tapError) {
      console.error('Failed to track review tap:', tapError)
      // Don't fail the redirect, just log the error
    }

    // Update partner's last review tap timestamp
    await supabase
      .from('partners')
      .update({ last_review_tap_at: new Date().toISOString() })
      .eq('id', partnerId)

    return NextResponse.json({
      success: true,
      partnerName: partner.location_name || partner.company_name,
      redirectUrl: partner.google_review_url,
    })
  } catch (error) {
    console.error('Error in review tap tracking:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
