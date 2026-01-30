import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

// Helper to get location from IP
async function getLocationFromIP(ip: string) {
  try {
    // Free IP geolocation service
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
    const { cardId, action, tapId, buttonType } = body

    // Get request metadata
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'
    const deviceType = getDeviceType(userAgent)

    if (action === 'page_view') {
      // Get location from IP
      const location = await getLocationFromIP(ip)

      // Track the tap
      const { data: tap, error } = await supabase
        .from('nfc_card_taps')
        .insert({
          card_id: cardId,
          tap_type: 'customer',
          ip_address: ip,
          user_agent: userAgent,
          device_type: deviceType,
          location_city: location.city,
          location_region: location.region,
          location_country: location.country,
        })
        .select()
        .single()

      if (error) {
        console.error('Failed to track tap:', error)
        return NextResponse.json(
          { error: 'Failed to track tap' },
          { status: 500 },
        )
      }

      return NextResponse.json({ success: true, tapId: tap.id })
    }

    if (action === 'button_click' && tapId && buttonType) {
      // Track button click
      const { error } = await supabase.from('nfc_button_clicks').insert({
        tap_id: tapId,
        button_type: buttonType,
      })

      if (error) {
        console.error('Failed to track button click:', error)
        return NextResponse.json(
          { error: 'Failed to track button click' },
          { status: 500 },
        )
      }

      // If it's a form submission, mark tap as converted
      if (buttonType === 'form_submit') {
        await supabase
          .from('nfc_card_taps')
          .update({
            converted: true,
            converted_at: new Date().toISOString(),
            conversion_type: 'form',
          })
          .eq('id', tapId)
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Error in tap tracking:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
