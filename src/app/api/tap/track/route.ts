import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

// Get location from Vercel geo headers (instant, no external API call)
function getLocationFromHeaders(request: NextRequest) {
  return {
    city: request.headers.get('x-vercel-ip-city') || null,
    region: request.headers.get('x-vercel-ip-country-region') || null,
    country: request.headers.get('x-vercel-ip-country') || null,
  }
}

// Helper to detect device type
function getDeviceType(userAgent: string): string {
  if (/mobile|android|iphone/i.test(userAgent)) return 'mobile'
  if (/tablet|ipad/i.test(userAgent)) return 'tablet'
  return 'desktop'
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const secret = process.env.TAP_TRACK_SECRET
    if (secret) {
      const headerSecret = request.headers.get('x-tap-secret')
      const bodySecret = (body as { tapSecret?: string }).tapSecret
      if (headerSecret !== secret && bodySecret !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const supabase = createAdminClient()
    const { cardId, partnerId, action, tapId, buttonType } = body

    // Get request metadata
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'
    const deviceType = getDeviceType(userAgent)

    if (action === 'page_view') {
      // Get location from Vercel geo headers (instant)
      const location = getLocationFromHeaders(request)

      // If partnerId provided, look up the partner
      let partnerData = null
      if (partnerId) {
        const { data: partner } = await supabase
          .from('partners')
          .select(
            'id, location_name, company_name, partner_type, location_type, phone, total_taps, total_conversions, coupon_code, placard_type',
          )
          .eq('id', partnerId)
          .eq('partner_type', 'location')
          .single()

        if (partner) {
          partnerData = partner

          // Increment partner tap count and update last tap timestamp
          await supabase
            .from('partners')
            .update({
              total_taps: (partner.total_taps || 0) + 1,
              last_sasquatch_tap_at: new Date().toISOString(),
            })
            .eq('id', partner.id)
        }
      }

      // Track the tap
      const { data: tap, error } = await supabase
        .from('nfc_card_taps')
        .insert({
          card_id: cardId,
          partner_id: partnerId || null,
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

      // Generate coupon code if not set
      let couponCode = partnerData?.coupon_code
      if (!couponCode && partnerData?.company_name) {
        // Auto-generate: First 4 letters of company name + 20
        const cleanName = partnerData.company_name.replace(/[^a-zA-Z]/g, '')
        couponCode = (cleanName.slice(0, 4).toUpperCase() || 'SCC') + '20'
      } else if (!couponCode) {
        couponCode = 'SCC20'
      }

      return NextResponse.json({
        success: true,
        tapId: tap.id,
        partnerName:
          partnerData?.location_name || partnerData?.company_name || null,
        locationType: partnerData?.location_type || null,
        placardType: partnerData?.placard_type || 'standard',
        couponCode,
      })
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

      // Track potential conversions. These are marked "pending" for manual
      // confirmation — credits are NOT auto-awarded.
      //
      // The button names below must match what the pages actually fire.
      // They drifted apart: /tap and the partner landing page emit
      // booking_widget_open / booking_widget_submit / text / text_us, none of
      // which were listed here, so real engagement (including 6 completed
      // booking submissions) was recorded as a click but never as a
      // conversion. Keep this list in sync with the trackButtonClick calls in
      // src/app/tap/page.tsx, src/components/partners/PartnerLandingLayout.tsx
      // and src/components/nfc/NfcBookingWidget.tsx.
      const CONVERSION_BUTTONS: Record<string, string> = {
        booking_widget_submit: 'booking',
        booking_widget_open: 'booking_started',
        booking_page: 'booking',
        form_submit: 'form',
        text_chat: 'text_chat',
        text: 'text_chat',
        text_us: 'text_chat',
        call: 'call',
      }
      if (CONVERSION_BUTTONS[buttonType]) {
        // Get the tap with partner info
        const { data: tapData } = await supabase
          .from('nfc_card_taps')
          .select('partner_id')
          .eq('id', tapId)
          .single()

        // Mark as pending conversion (not confirmed yet)
        // conversion_type indicates how they engaged
        // converted = false means pending, true = confirmed by admin
        // Never downgrade a stronger signal: a completed booking submit
        // must not be overwritten by a later 'call' or widget re-open.
        const RANK: Record<string, number> = {
          booking: 4,
          form: 3,
          text_chat: 2,
          call: 1,
          booking_started: 0,
        }
        const nextType = CONVERSION_BUTTONS[buttonType]
        const { data: existing } = await supabase
          .from('nfc_card_taps')
          .select('conversion_type')
          .eq('id', tapId)
          .single()

        const currentRank = RANK[existing?.conversion_type ?? ''] ?? -1
        if ((RANK[nextType] ?? -1) > currentRank) {
          await supabase
            .from('nfc_card_taps')
            .update({ conversion_type: nextType })
            .eq('id', tapId)
        }

        // If there's a partner, increment their potential lead count (not confirmed yet)
        if (tapData?.partner_id) {
          console.log(
            `📱 Potential lead from location partner: ${tapData.partner_id}`,
          )
        }
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
