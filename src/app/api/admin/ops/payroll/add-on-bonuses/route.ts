import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { loadAddOnBonuses } from '@/lib/ops/add-on-bonuses'
import { loadPayrollComponentOverrides } from '@/lib/ops/payroll-component-overrides'
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

    const db = createAdminClient()
    const summary = await loadAddOnBonuses(db, {
      startDate,
      endDate,
      staffUserId,
    })

    const overrides = await loadPayrollComponentOverrides(
      db,
      'add_on_bonus',
      summary.rows.map((row) => row.key),
    )
    const rows = summary.rows.map((row) => ({
      ...row,
      calculatedBonusAmount: row.bonusAmount,
      overrideAmount: overrides.get(row.key) ?? null,
      bonusAmount: overrides.get(row.key) ?? row.bonusAmount,
    }))
    const total = (status: 'earned' | 'pending') =>
      Math.round(
        rows
          .filter((row) => row.status === status)
          .reduce((sum, row) => sum + row.bonusAmount, 0) * 100,
      ) / 100

    return NextResponse.json({
      startDate,
      endDate,
      rows,
      earnedBonus: total('earned'),
      pendingBonus: total('pending'),
      eligibleRevenue: summary.eligibleRevenue,
    })
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
