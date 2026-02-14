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
        // Add chart data
        tapHistory: await getTapHistory(supabase, partner.id),
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

async function getTapHistory(supabase: any, partnerId: string) {
  // Get taps from last 30 days
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const { data: taps, error } = await supabase
    .from('nfc_card_taps')
    .select('created_at')
    .eq('partner_id', partnerId)
    .gte('created_at', thirtyDaysAgo.toISOString())
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching tap history:', error)
    return []
  }

  // Aggregate by date
  const historyMap = new Map<string, number>()

  // Initialize last 30 days with 0
  for (let i = 0; i < 30; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
    historyMap.set(dateStr, 0)
  }

  // Count actual taps
  taps?.forEach((tap: any) => {
    const dateStr = new Date(tap.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
    if (historyMap.has(dateStr)) {
      historyMap.set(dateStr, (historyMap.get(dateStr) || 0) + 1)
    }
  })

  // Convert to array and reverse to show oldest to newest
  return Array.from(historyMap.entries())
    .map(([date, count]) => ({ date, count }))
    .reverse()
}
