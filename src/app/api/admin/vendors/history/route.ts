/**
 * Get tap history for a specific vendor
 * GET /api/admin/vendors/history?partnerId=...
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const partnerId = searchParams.get('partnerId')

    if (!partnerId) {
      return NextResponse.json(
        { error: 'partnerId is required' },
        { status: 400 },
      )
    }

    const supabase = await createAdminClient()

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
      return NextResponse.json({ error: error.message }, { status: 500 })
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
    const history = Array.from(historyMap.entries())
      .map(([date, count]) => ({ date, count }))
      .reverse()

    return NextResponse.json({ history })
  } catch (error) {
    console.error('Error fetching vendor history:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
