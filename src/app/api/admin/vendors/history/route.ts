/**
 * Get tap history for a specific vendor
 * GET /api/admin/vendors/history?partnerId=...
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'
import { buildThirtyDayTapHistory } from '@/lib/nfc-tap-history'

export async function GET(request: NextRequest) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || (role !== 'admin' && role !== 'owner')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
      .select('tapped_at')
      .eq('partner_id', partnerId)
      .gte('tapped_at', thirtyDaysAgo.toISOString())
      .order('tapped_at', { ascending: true })

    if (error) {
      console.error('Error fetching tap history:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const history = buildThirtyDayTapHistory(
      (taps || []).map((tap) => tap.tapped_at),
    )

    return NextResponse.json({ history })
  } catch (error) {
    console.error('Error fetching vendor history:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
