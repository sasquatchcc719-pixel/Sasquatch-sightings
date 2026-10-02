import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { loadAddOnBonuses } from '@/lib/ops/add-on-bonuses'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate') || ''
    const endDate = searchParams.get('endDate') || ''
    const staffUserId = searchParams.get('staffUserId') || undefined

    if (!startDate || !endDate || startDate > endDate) {
      return NextResponse.json(
        { error: 'A valid startDate and endDate are required' },
        { status: 400 },
      )
    }

    const summary = await loadAddOnBonuses(createAdminClient(), {
      startDate,
      endDate,
      staffUserId,
    })

    return NextResponse.json({ startDate, endDate, ...summary })
  } catch (error) {
    console.error('[payroll/add-on-bonuses][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: 'Failed to load add-on bonuses' },
      { status },
    )
  }
}
