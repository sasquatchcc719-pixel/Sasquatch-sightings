import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { parseHourlyRate } from '@/lib/ops/timesheet-pay'
import { createAdminClient } from '@/supabase/server'

const WORK_TYPES = new Set(['training', 'job', 'admin', 'other'])

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function calculatePayableMinutes(
  startedAt: string,
  endedAt: string,
  breakMinutes: number,
): { payableMinutes: number } | { error: string } {
  const startMs = new Date(startedAt).getTime()
  const endMs = new Date(endedAt).getTime()

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { error: 'Start and end times are required' }
  }

  if (endMs <= startMs) {
    return { error: 'End time must be after start time' }
  }

  if (!Number.isInteger(breakMinutes) || breakMinutes < 0) {
    return { error: 'Break minutes must be zero or greater' }
  }

  const grossMinutes = Math.round((endMs - startMs) / 60000)
  const payableMinutes = grossMinutes - breakMinutes

  if (payableMinutes < 0) {
    return { error: 'Break minutes cannot exceed the shift length' }
  }

  return { payableMinutes }
}

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const date =
      searchParams.get('date') || new Date().toISOString().split('T')[0]
    const staffUserId = searchParams.get('staffUserId')

    let query = supabase
      .from('ops_timesheet_entries')
      .select(
        `
        id,
        staff_user_id,
        work_date,
        started_at,
        ended_at,
        break_minutes,
        payable_minutes,
        hourly_rate,
        gross_pay,
        work_type,
        source,
        status,
        notes,
        created_at,
        updated_at,
        staff_users (
          id,
          display_name,
          role
        )
      `,
      )
      .eq('work_date', date)
      .order('started_at', { ascending: true })

    if (staffUserId) {
      query = query.eq('staff_user_id', staffUserId)
    }

    const { data, error } = await query
    if (error) throw error

    const entries = (data || []).map((entry) => {
      const staff = Array.isArray(entry.staff_users)
        ? entry.staff_users[0]
        : entry.staff_users

      return {
        id: entry.id,
        staffUserId: entry.staff_user_id,
        staffDisplayName: staff?.display_name ?? 'Unknown',
        staffRole: staff?.role ?? 'tech',
        workDate: entry.work_date,
        startedAt: entry.started_at,
        endedAt: entry.ended_at,
        breakMinutes: entry.break_minutes,
        payableMinutes: entry.payable_minutes,
        hourlyRate: Number(entry.hourly_rate || 0),
        grossPay: Number(entry.gross_pay || 0),
        workType: entry.work_type,
        source: entry.source,
        status: entry.status,
        notes: entry.notes,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
      }
    })

    return NextResponse.json({
      date,
      entries,
      totalPayableMinutes: entries.reduce(
        (sum, entry) => sum + Number(entry.payableMinutes || 0),
        0,
      ),
      totalGrossPay: entries.reduce(
        (sum, entry) => sum + Number(entry.grossPay || 0),
        0,
      ),
    })
  } catch (error) {
    console.error('[payroll/timesheet-entries][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return jsonError('Failed to load payroll timesheets', status)
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))

    const staffUserId = String(body.staffUserId || '')
    const workDate = String(body.workDate || '')
    const startedAt = String(body.startedAt || '')
    const endedAt = String(body.endedAt || '')
    const breakMinutes = Number(body.breakMinutes || 0)
    const hourlyRate = parseHourlyRate(body.hourlyRate)
    const workType = String(body.workType || 'training')
    const notes = body.notes ? String(body.notes).trim() : null

    if (!staffUserId) return jsonError('Staff member is required', 400)
    if (!workDate) return jsonError('Work date is required', 400)
    if (hourlyRate === null) {
      return jsonError('Hourly rate must be between $0.01 and $1,000', 400)
    }
    if (!WORK_TYPES.has(workType)) return jsonError('Invalid work type', 400)

    const calculated = calculatePayableMinutes(startedAt, endedAt, breakMinutes)
    if ('error' in calculated) return jsonError(calculated.error, 400)

    const { data: staff, error: staffError } = await supabase
      .from('staff_users')
      .select('id')
      .eq('id', staffUserId)
      .eq('is_active', true)
      .maybeSingle()

    if (staffError) throw staffError
    if (!staff) return jsonError('Staff member was not found', 404)

    const { data, error } = await supabase
      .from('ops_timesheet_entries')
      .insert({
        staff_user_id: staffUserId,
        work_date: workDate,
        started_at: startedAt,
        ended_at: endedAt,
        break_minutes: breakMinutes,
        payable_minutes: calculated.payableMinutes,
        hourly_rate: hourlyRate,
        work_type: workType,
        source: 'manual',
        status: 'draft',
        notes,
        created_by: access.id,
        updated_by: access.id,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ entry: data }, { status: 201 })
  } catch (error) {
    console.error('[payroll/timesheet-entries][POST]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return jsonError('Failed to create payroll timesheet entry', status)
  }
}
