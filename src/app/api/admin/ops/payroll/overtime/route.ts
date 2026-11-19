import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  calculatePayPeriodOvertime,
  getSundayWorkweek,
} from '@/lib/ops/timesheet-pay'
import { createAdminClient } from '@/supabase/server'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function unwrap<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function minutesBetween(startedAt: string, endedAt: Date) {
  return Math.max(
    0,
    Math.round((endedAt.getTime() - new Date(startedAt).getTime()) / 60000),
  )
}

function liveBreakMinutes(entry: {
  clock_state?: string | null
  break_started_at?: string | null
}) {
  if (entry.clock_state !== 'on_break' || !entry.break_started_at) return 0
  return Math.max(
    0,
    Math.round(
      (Date.now() - new Date(entry.break_started_at).getTime()) / 60000,
    ),
  )
}

function parseScope(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get('startDate') || ''
  const endDate = searchParams.get('endDate') || ''
  const staffUserId = searchParams.get('staffUserId') || ''
  if (!startDate || !endDate || startDate > endDate) return null
  return { startDate, endDate, staffUserId }
}

async function calculateOvertime(
  supabase: ReturnType<typeof createAdminClient>,
  startDate: string,
  endDate: string,
  staffUserId: string,
) {
  const queryStartDate = getSundayWorkweek(startDate).startDate
  const queryEndDate = getSundayWorkweek(endDate).endDate
  let query = supabase
    .from('ops_timesheet_entries')
    .select(
      `
        staff_user_id,
        work_date,
        started_at,
        break_minutes,
        break_started_at,
        payable_minutes,
        hourly_rate,
        clock_state,
        staff_users ( display_name )
      `,
    )
    .gte('work_date', queryStartDate)
    .lte('work_date', queryEndDate)
    .order('started_at', { ascending: true })

  if (staffUserId) query = query.eq('staff_user_id', staffUserId)

  const { data, error } = await query
  if (error) throw error

  const now = new Date()
  const entries = (data || []).map((entry) => {
    const staff = unwrap(entry.staff_users)
    const breakMinutes =
      Number(entry.break_minutes || 0) + liveBreakMinutes(entry)
    const payableMinutes =
      entry.clock_state === 'complete'
        ? Number(entry.payable_minutes || 0)
        : Math.max(0, minutesBetween(entry.started_at, now) - breakMinutes)

    return {
      staffUserId: entry.staff_user_id,
      staffDisplayName: staff?.display_name || 'Unknown',
      workDate: entry.work_date,
      startedAt: entry.started_at,
      payableMinutes,
      hourlyRate: Number(entry.hourly_rate || 0),
    }
  })

  return {
    ...calculatePayPeriodOvertime(entries, startDate, endDate),
    hasActiveEntries: (data || []).some(
      (entry) =>
        entry.work_date >= startDate &&
        entry.work_date <= endDate &&
        entry.clock_state !== 'complete',
    ),
  }
}

async function loadApplied(
  supabase: ReturnType<typeof createAdminClient>,
  startDate: string,
  endDate: string,
  staffUserId: string,
) {
  let query = supabase
    .from('ops_overtime_premiums')
    .select(
      `
        id,
        staff_user_id,
        overtime_minutes,
        premium_pay,
        calculation,
        status,
        staff_users ( display_name )
      `,
    )
    .eq('period_start', startDate)
    .eq('period_end', endDate)

  if (staffUserId) query = query.eq('staff_user_id', staffUserId)

  const { data, error } = await query
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id,
    staffUserId: row.staff_user_id,
    staffDisplayName: unwrap(row.staff_users)?.display_name || 'Unknown',
    minutes: Number(row.overtime_minutes || 0),
    premiumPay: Number(row.premium_pay || 0),
    calculation: row.calculation,
    status: row.status,
  }))
}

function responseBody(
  calculated: Awaited<ReturnType<typeof calculateOvertime>>,
  appliedRows: Awaited<ReturnType<typeof loadApplied>>,
) {
  const calculatedByStaff = new Map<
    string,
    { minutes: number; premiumCents: number }
  >()
  for (const group of calculated.breakdown) {
    const current = calculatedByStaff.get(group.staffUserId) || {
      minutes: 0,
      premiumCents: 0,
    }
    current.minutes += group.minutes
    current.premiumCents += group.premiumCents
    calculatedByStaff.set(group.staffUserId, current)
  }
  const appliedByStaff = new Map(
    appliedRows.map((row) => [row.staffUserId, row]),
  )
  const appliedMatchesCalculation =
    calculatedByStaff.size > 0 &&
    calculatedByStaff.size === appliedRows.length &&
    [...calculatedByStaff].every(([staffUserId, current]) => {
      const applied = appliedByStaff.get(staffUserId)
      return (
        applied?.minutes === current.minutes &&
        Math.round(applied.premiumPay * 100) === current.premiumCents
      )
    })

  return {
    calculation: {
      minutes: calculated.minutes,
      premiumPay: calculated.premiumCents / 100,
      breakdown: calculated.breakdown.map((group) => ({
        ...group,
        premiumPay: group.premiumCents / 100,
      })),
    },
    applied: {
      rows: appliedRows,
      totalPay: appliedRows.reduce((sum, row) => sum + row.premiumPay, 0),
      matchesCalculation: appliedMatchesCalculation,
    },
    hasActiveEntries: calculated.hasActiveEntries,
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const scope = parseScope(request)
    if (!scope) {
      return jsonError('A valid startDate and endDate are required', 400)
    }
    const supabase = createAdminClient()
    const [calculated, appliedRows] = await Promise.all([
      calculateOvertime(
        supabase,
        scope.startDate,
        scope.endDate,
        scope.staffUserId,
      ),
      loadApplied(supabase, scope.startDate, scope.endDate, scope.staffUserId),
    ])

    return NextResponse.json(responseBody(calculated, appliedRows))
  } catch (error) {
    console.error('[payroll/overtime][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return jsonError('Failed to load overtime', status)
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner'])
    const scope = parseScope(request)
    if (!scope) {
      return jsonError('A valid startDate and endDate are required', 400)
    }
    const supabase = createAdminClient()
    const calculated = await calculateOvertime(
      supabase,
      scope.startDate,
      scope.endDate,
      scope.staffUserId,
    )
    if (calculated.hasActiveEntries) {
      return jsonError('Clock out before applying overtime', 409)
    }
    if (calculated.breakdown.length === 0) {
      return jsonError('No overtime is currently calculated', 400)
    }

    const byStaff = new Map<
      string,
      {
        minutes: number
        premiumCents: number
        calculation: Array<{
          minutes: number
          hourlyRate: number
          premiumPay: number
          method: string
          weekStart: string
        }>
      }
    >()
    for (const group of calculated.breakdown) {
      const current = byStaff.get(group.staffUserId) || {
        minutes: 0,
        premiumCents: 0,
        calculation: [],
      }
      current.minutes += group.minutes
      current.premiumCents += group.premiumCents
      current.calculation.push({
        minutes: group.minutes,
        hourlyRate: group.hourlyRate,
        premiumPay: group.premiumCents / 100,
        method: group.method,
        weekStart: group.weekStart,
      })
      byStaff.set(group.staffUserId, current)
    }

    const staffIds = [...byStaff.keys()]
    const { data: paidRows, error: paidError } = await supabase
      .from('ops_overtime_premiums')
      .select('staff_user_id')
      .eq('period_start', scope.startDate)
      .eq('period_end', scope.endDate)
      .eq('status', 'paid')
      .in('staff_user_id', staffIds)
    if (paidError) throw paidError
    if ((paidRows || []).length > 0) {
      return jsonError('Paid overtime cannot be changed', 409)
    }

    const rows = [...byStaff].map(([staffUserId, current]) => ({
      staff_user_id: staffUserId,
      period_start: scope.startDate,
      period_end: scope.endDate,
      overtime_minutes: current.minutes,
      premium_pay: current.premiumCents / 100,
      calculation: current.calculation,
      status: 'approved',
      created_by: access.id,
      updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase
      .from('ops_overtime_premiums')
      .upsert(rows, {
        onConflict: 'staff_user_id,period_start,period_end',
      })
    if (error) throw error

    const appliedRows = await loadApplied(
      supabase,
      scope.startDate,
      scope.endDate,
      scope.staffUserId,
    )
    return NextResponse.json(responseBody(calculated, appliedRows), {
      status: 201,
    })
  } catch (error) {
    console.error('[payroll/overtime][POST]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return jsonError('Failed to apply overtime', status)
  }
}
