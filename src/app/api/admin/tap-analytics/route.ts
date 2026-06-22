import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

const TIMEFRAMES = new Set(['today', 'week', 'month', 'all'])

function getStartDate(timeframe: string) {
  const now = new Date()

  if (timeframe === 'today') {
    now.setHours(0, 0, 0, 0)
    return now.toISOString()
  }

  if (timeframe === 'week') {
    now.setDate(now.getDate() - 7)
    return now.toISOString()
  }

  if (timeframe === 'month') {
    now.setDate(now.getDate() - 30)
    return now.toISOString()
  }

  return new Date(0).toISOString()
}

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])

    const timeframe = request.nextUrl.searchParams.get('timeframe') || 'all'
    if (!TIMEFRAMES.has(timeframe)) {
      return NextResponse.json({ error: 'Invalid timeframe' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc(
      'get_business_card_tap_analytics',
      {
        p_start_at: getStartDate(timeframe),
      },
    )

    if (error) {
      console.error('[tap-analytics] RPC error:', error)
      return NextResponse.json(
        { error: 'Failed to load tap analytics' },
        { status: 500 },
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('[tap-analytics] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load tap analytics' },
      { status: 500 },
    )
  }
}
