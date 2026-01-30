/**
 * Location Partner Login
 * POST /api/location-partner/login
 * Verify phone + PIN and return partner stats
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAdminClient()
    const body = await request.json()
    const { partnerId, pin } = body

    if (!partnerId || !pin) {
      return NextResponse.json(
        { error: 'Partner ID and PIN are required' },
        { status: 400 },
      )
    }

    // Find the partner and verify PIN
    const { data: partner, error } = await supabase
      .from('partners')
      .select(
        'id, company_name, location_name, phone, credit_balance, total_taps, total_conversions, pin, partner_type',
      )
      .eq('id', partnerId)
      .eq('partner_type', 'location')
      .single()

    if (error || !partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    }

    // Verify PIN
    if (partner.pin !== pin) {
      return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 })
    }

    // Return partner stats (without PIN)
    return NextResponse.json({
      success: true,
      partner: {
        id: partner.id,
        name: partner.location_name || partner.company_name,
        phone: partner.phone,
        creditBalance: partner.credit_balance || 0,
        totalTaps: partner.total_taps || 0,
        totalConversions: partner.total_conversions || 0,
      },
    })
  } catch (error) {
    console.error('Location partner login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
