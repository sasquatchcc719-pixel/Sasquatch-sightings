import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

/**
 * Public read-only partner display info for the /location landing page.
 * Deliberately separate from /api/tap/track: content blockers filter URLs
 * containing "track", which used to take the partner name and coupon code
 * down with them. This endpoint carries no tracking side effects.
 */
export async function GET(request: NextRequest) {
  try {
    const partnerId = request.nextUrl.searchParams.get('id')
    if (!partnerId) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: partner } = await supabase
      .from('partners')
      .select(
        'id, location_name, company_name, location_type, coupon_code, placard_type',
      )
      .eq('id', partnerId)
      .eq('partner_type', 'location')
      .single()

    if (!partner) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Same coupon fallback rules as /api/tap/track
    let couponCode = partner.coupon_code
    if (!couponCode && partner.company_name) {
      const cleanName = partner.company_name.replace(/[^a-zA-Z]/g, '')
      couponCode = (cleanName.slice(0, 4).toUpperCase() || 'SCC') + '20'
    } else if (!couponCode) {
      couponCode = 'SCC20'
    }

    return NextResponse.json({
      partnerName: partner.location_name || partner.company_name || null,
      locationType: partner.location_type || null,
      placardType: partner.placard_type || 'standard',
      couponCode,
    })
  } catch (error) {
    console.error('Failed to load partner info:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
