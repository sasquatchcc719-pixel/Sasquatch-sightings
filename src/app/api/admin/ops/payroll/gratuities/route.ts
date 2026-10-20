import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { loadPayrollGratuities } from '@/lib/ops/payroll-gratuities'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate') || ''
    const endDate = searchParams.get('endDate') || ''
    const validDate = (value: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
      return NextResponse.json(
        { error: 'A valid startDate and endDate are required' },
        { status: 400 },
      )
    }
    const summary = await loadPayrollGratuities(createAdminClient(), {
      startDate,
      endDate,
      staffUserId: searchParams.get('staffUserId') || undefined,
    })
    return NextResponse.json({ startDate, endDate, ...summary })
  } catch (error) {
    console.error('[payroll/gratuities][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: 'Failed to load payroll gratuities' },
      { status },
    )
  }
}
