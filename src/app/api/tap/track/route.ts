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
    const { cardId, partnerId, action, tapId, buttonType } = body

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

      // If partnerId provided, look up the partner
      let partnerData = null
      if (partnerId) {
        const { data: partner } = await supabase
          .from('partners')
          .select(
            'id, location_name, company_name, partner_type, phone, total_taps, total_conversions',
          )
          .eq('id', partnerId)
          .eq('partner_type', 'location')
          .single()

        if (partner) {
          partnerData = partner

          // Increment partner tap count
          await supabase
            .from('partners')
            .update({ total_taps: (partner.total_taps || 0) + 1 })
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

      return NextResponse.json({
        success: true,
        tapId: tap.id,
        partnerName:
          partnerData?.location_name || partnerData?.company_name || null,
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

      // If it's a booking/form submission, mark as conversion and notify partner
      if (buttonType === 'form_submit' || buttonType === 'booking_page') {
        // Get the tap with partner info
        const { data: tap } = await supabase
          .from('nfc_card_taps')
          .select('partner_id')
          .eq('id', tapId)
          .single()

        // Mark as converted
        await supabase
          .from('nfc_card_taps')
          .update({
            converted: true,
            converted_at: new Date().toISOString(),
            conversion_type: buttonType === 'booking_page' ? 'booking' : 'form',
          })
          .eq('id', tapId)

        // If there's a partner, reward them
        if (tap?.partner_id) {
          const { data: partner } = await supabase
            .from('partners')
            .select('*')
            .eq('id', tap.partner_id)
            .single()

          if (partner) {
            // Increment conversion count
            await supabase
              .from('partners')
              .update({
                total_conversions: (partner.total_conversions || 0) + 1,
              })
              .eq('id', partner.id)

            // Award credit ($20 for each conversion)
            const creditAmount = 20
            const newBalance = (partner.credit_balance || 0) + creditAmount

            await supabase
              .from('partners')
              .update({ credit_balance: newBalance })
              .eq('id', partner.id)

            // Send SMS notification to partner
            if (partner.phone) {
              try {
                await fetch(
                  `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/sms/send`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      to: partner.phone,
                      message: `🎉 Your NFC card at ${partner.location_name || partner.company_name} just earned you $${creditAmount} credit! New balance: $${newBalance}. View: ${process.env.NEXT_PUBLIC_SITE_URL}/partner`,
                    }),
                  },
                )
              } catch (error) {
                console.error('Failed to send SMS notification:', error)
              }
            }
          }
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
