import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { loadDiscountAnalytics } from '@/lib/ops/discount-analytics'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])

    const requestedYear = Number(request.nextUrl.searchParams.get('year'))
    const currentYear = new Date().getFullYear()
    const year =
      Number.isInteger(requestedYear) &&
      requestedYear >= 2020 &&
      requestedYear <= currentYear + 1
        ? requestedYear
        : currentYear

    const analytics = await loadDiscountAnalytics(createAdminClient(), {
      year,
    })

    return NextResponse.json(analytics, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    console.error('[admin/stats/discounts][GET]', error)
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to load discount analytics'
    if (message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
