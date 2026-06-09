import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { parseHourlyRate } from '@/lib/ops/timesheet-pay'
import { createAdminClient } from '@/supabase/server'

const WORK_TYPES = new Set(['training', 'job', 'admin', 'other'])
const STATUSES = new Set(['draft', 'approved', 'paid'])

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const { id } = await params
    const body = await request.json().catch(() => ({}))

    const { data: existing, error: findError } = await supabase
      .from('ops_timesheet_entries')
      .select(
        'id, started_at, ended_at, break_minutes, hourly_rate, work_type, status, notes',
      )
      .eq('id', id)
      .maybeSingle()

    if (findError) throw findError
    if (!existing) return jsonError('Timesheet entry was not found', 404)
    if (existing.status === 'paid') {
      return jsonError('Paid timesheet entries cannot be edited', 409)
    }

    const nextStartedAt =
      body.startedAt !== undefined
        ? String(body.startedAt)
        : existing.started_at
    const nextEndedAt =
      body.endedAt !== undefined ? String(body.endedAt) : existing.ended_at
    const nextBreakMinutes =
      body.breakMinutes !== undefined
        ? Number(body.breakMinutes)
        : Number(existing.break_minutes || 0)
    const nextWorkType =
      body.workType !== undefined ? String(body.workType) : existing.work_type
    const nextHourlyRate = parseHourlyRate(
      body.hourlyRate !== undefined ? body.hourlyRate : existing.hourly_rate,
    )
    const nextStatus =
      body.status !== undefined ? String(body.status) : existing.status

    if (!WORK_TYPES.has(nextWorkType))
      return jsonError('Invalid work type', 400)
    if (nextHourlyRate === null) {
      return jsonError('Hourly rate must be between $0.01 and $1,000', 400)
    }
    if (!STATUSES.has(nextStatus)) return jsonError('Invalid status', 400)

    const calculated = calculatePayableMinutes(
      nextStartedAt,
      nextEndedAt,
      nextBreakMinutes,
    )
    if ('error' in calculated) return jsonError(calculated.error, 400)

    const update: Record<string, unknown> = {
      started_at: nextStartedAt,
      ended_at: nextEndedAt,
      break_minutes: nextBreakMinutes,
      payable_minutes: calculated.payableMinutes,
      hourly_rate: nextHourlyRate,
      work_type: nextWorkType,
      status: nextStatus,
      updated_by: access.id,
      updated_at: new Date().toISOString(),
    }

    if (body.notes !== undefined) {
      const notes = String(body.notes || '').trim()
      update.notes = notes || null
    }

    const { data, error } = await supabase
      .from('ops_timesheet_entries')
      .update(update)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ entry: data })
  } catch (error) {
    console.error('[payroll/timesheet-entries/[id]][PATCH]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return jsonError('Failed to update payroll timesheet entry', status)
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const { id } = await params

    const { data: existing, error: findError } = await supabase
      .from('ops_timesheet_entries')
      .select('id, status')
      .eq('id', id)
      .maybeSingle()

    if (findError) throw findError
    if (!existing) return jsonError('Timesheet entry was not found', 404)
    if (existing.status === 'paid') {
      return jsonError('Paid timesheet entries cannot be deleted', 409)
    }

    const { error } = await supabase
      .from('ops_timesheet_entries')
      .delete()
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[payroll/timesheet-entries/[id]][DELETE]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return jsonError('Failed to delete payroll timesheet entry', status)
  }
}
