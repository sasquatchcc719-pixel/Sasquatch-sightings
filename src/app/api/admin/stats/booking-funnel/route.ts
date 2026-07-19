import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadBookingFunnel } from '@/lib/ops/booking-funnel'

/**
 * Booking-widget funnel for /admin/stats: quote-to-book conversion and where
 * visitors drop off.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing'])
    const supabase = createAdminClient()

    const windowParam = Number(request.nextUrl.searchParams.get('days'))
    const windowDays =
      Number.isFinite(windowParam) && windowParam > 0
        ? Math.min(Math.floor(windowParam), 365)
        : 90

    const funnel = await loadBookingFunnel(supabase, { windowDays })
    return NextResponse.json(funnel)
  } catch (err) {
    console.error('[stats/booking-funnel]', err)
    const message =
      err instanceof Error ? err.message : 'Failed to load booking funnel'
    if (message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
