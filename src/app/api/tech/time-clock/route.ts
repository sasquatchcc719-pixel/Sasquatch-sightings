import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { mountainDateKey } from '@/lib/ops/timesheet-pay'
import { createAdminClient } from '@/supabase/server'

const DEFAULT_HOURLY_RATE = 22
const RECENT_CLOCK_OUT_GRACE_MS = 90_000

type ClockState = 'active' | 'on_break' | 'complete'

type TimesheetEntry = {
  id: string
  staff_user_id: string
  work_date: string
  started_at: string
  ended_at: string
  break_minutes: number
  payable_minutes: number
  hourly_rate: number | string
  gross_pay: number | string
  work_type: string
  status: string
  source: string
  notes: string | null
  clock_state: ClockState
  break_started_at: string | null
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function addOneMinute(value: Date) {
  return new Date(value.getTime() + 60_000).toISOString()
}

function minutesBetween(startedAt: string, endedAt: Date) {
  return Math.max(
    0,
    Math.round((endedAt.getTime() - new Date(startedAt).getTime()) / 60000),
  )
}

function activeBreakMinutes(entry: TimesheetEntry, now: Date) {
  if (entry.clock_state !== 'on_break' || !entry.break_started_at) return 0
  return Math.max(
    0,
    Math.round(
      (now.getTime() - new Date(entry.break_started_at).getTime()) / 60000,
    ),
  )
}

function calculatedPayableMinutes(entry: TimesheetEntry, now: Date) {
  return Math.max(
    0,
    minutesBetween(entry.started_at, now) -
      Number(entry.break_minutes || 0) -
      activeBreakMinutes(entry, now),
  )
}

function serializeEntry(entry: TimesheetEntry | null) {
  if (!entry) return null
  const now = new Date()
  const livePayableMinutes =
    entry.clock_state === 'complete'
      ? Number(entry.payable_minutes || 0)
      : calculatedPayableMinutes(entry, now)
  const hourlyRate = Number(entry.hourly_rate || 0)

  return {
    id: entry.id,
    workDate: entry.work_date,
    startedAt: entry.started_at,
    endedAt:
      entry.clock_state === 'complete' ? entry.ended_at : now.toISOString(),
    breakMinutes:
      Number(entry.break_minutes || 0) + activeBreakMinutes(entry, now),
    payableMinutes: livePayableMinutes,
    hourlyRate,
    grossPay: Math.round((livePayableMinutes / 60) * hourlyRate * 100) / 100,
    workType: entry.work_type,
    status: entry.status,
    source: entry.source,
    notes: entry.notes,
    clockState: entry.clock_state,
    breakStartedAt: entry.break_started_at,
  }
}

async function getActiveEntry(
  supabase: ReturnType<typeof createAdminClient>,
  staffUserId: string,
) {
  const { data, error } = await supabase
    .from('ops_timesheet_entries')
    .select(
      'id, staff_user_id, work_date, started_at, ended_at, break_minutes, payable_minutes, hourly_rate, gross_pay, work_type, status, source, notes, clock_state, break_started_at',
    )
    .eq('staff_user_id', staffUserId)
    .in('clock_state', ['active', 'on_break'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data as TimesheetEntry | null
}

async function getLatestCompletedEntry(
  supabase: ReturnType<typeof createAdminClient>,
  staffUserId: string,
) {
  const { data, error } = await supabase
    .from('ops_timesheet_entries')
    .select(
      'id, staff_user_id, work_date, started_at, ended_at, break_minutes, payable_minutes, hourly_rate, gross_pay, work_type, status, source, notes, clock_state, break_started_at',
    )
    .eq('staff_user_id', staffUserId)
    .eq('clock_state', 'complete')
    .order('ended_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data as TimesheetEntry | null
}

async function getHourlyRate(
  supabase: ReturnType<typeof createAdminClient>,
  staffUserId: string,
) {
  // The staff record is the single place a raise gets entered. Prefer it over
  // anything historical — copying the previous entry's rate forward is what made
  // raises invisible, since a new entry would inherit the pre-raise rate forever.
  const { data: staff, error: staffError } = await supabase
    .from('staff_users')
    .select('hourly_rate')
    .eq('id', staffUserId)
    .maybeSingle()

  if (staffError) throw staffError
  const staffRate = Number(staff?.hourly_rate || 0)
  if (staffRate > 0) return staffRate

  // No rate on the staff record yet — fall back to their last paid entry so
  // existing techs keep being paid correctly until a rate is set for them.
  const { data: latestEntry, error: latestError } = await supabase
    .from('ops_timesheet_entries')
    .select('hourly_rate')
    .eq('staff_user_id', staffUserId)
    .gt('hourly_rate', 0)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestError) throw latestError
  return Number(latestEntry?.hourly_rate || DEFAULT_HOURLY_RATE)
}

export async function GET() {
  try {
    const access = await requireAnyRole(['tech', 'owner', 'admin'])
    if (!access.staff) return jsonError('Staff record was not found', 404)

    const supabase = createAdminClient()
    const entry = await getActiveEntry(supabase, access.staff.id)

    return NextResponse.json({ entry: serializeEntry(entry) })
  } catch (error) {
    console.error('[tech/time-clock][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return jsonError('Failed to load time clock status', status)
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole(['tech', 'owner', 'admin'])
    if (!access.staff) return jsonError('Staff record was not found', 404)

    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || '')
    const now = new Date()
    const activeEntry = await getActiveEntry(supabase, access.staff.id)

    if (action === 'clock_in') {
      if (activeEntry) return jsonError('Already clocked in', 409)

      const latestCompletedEntry = await getLatestCompletedEntry(
        supabase,
        access.staff.id,
      )
      const latestEndedAtMs = latestCompletedEntry
        ? new Date(latestCompletedEntry.ended_at).getTime()
        : null

      if (
        latestEndedAtMs !== null &&
        Number.isFinite(latestEndedAtMs) &&
        now.getTime() - latestEndedAtMs >= 0 &&
        now.getTime() - latestEndedAtMs < RECENT_CLOCK_OUT_GRACE_MS
      ) {
        return jsonError(
          'You just clocked out. Wait a minute before clocking in again.',
          409,
        )
      }

      const hourlyRate = await getHourlyRate(supabase, access.staff.id)
      const { data, error } = await supabase
        .from('ops_timesheet_entries')
        .insert({
          staff_user_id: access.staff.id,
          work_date: mountainDateKey(now),
          started_at: now.toISOString(),
          ended_at: addOneMinute(now),
          break_minutes: 0,
          payable_minutes: 0,
          hourly_rate: hourlyRate,
          work_type: 'training',
          source: 'manual',
          status: 'draft',
          notes: 'Simple time clock entry. Clocked in from tech portal.',
          created_by: access.id,
          updated_by: access.id,
          clock_state: 'active',
          break_started_at: null,
        })
        .select(
          'id, staff_user_id, work_date, started_at, ended_at, break_minutes, payable_minutes, hourly_rate, gross_pay, work_type, status, source, notes, clock_state, break_started_at',
        )
        .single()

      if (error) throw error
      return NextResponse.json({
        entry: serializeEntry(data as TimesheetEntry),
      })
    }

    if (!activeEntry) return jsonError('No active clock entry found', 404)

    if (action === 'start_break') {
      if (activeEntry.clock_state === 'on_break') {
        return NextResponse.json({ entry: serializeEntry(activeEntry) })
      }

      const { data, error } = await supabase
        .from('ops_timesheet_entries')
        .update({
          clock_state: 'on_break',
          break_started_at: now.toISOString(),
          updated_by: access.id,
          updated_at: now.toISOString(),
        })
        .eq('id', activeEntry.id)
        .select(
          'id, staff_user_id, work_date, started_at, ended_at, break_minutes, payable_minutes, hourly_rate, gross_pay, work_type, status, source, notes, clock_state, break_started_at',
        )
        .single()

      if (error) throw error
      return NextResponse.json({
        entry: serializeEntry(data as TimesheetEntry),
      })
    }

    if (action === 'end_break') {
      if (activeEntry.clock_state !== 'on_break') {
        return NextResponse.json({ entry: serializeEntry(activeEntry) })
      }

      const breakMinutes =
        Number(activeEntry.break_minutes || 0) +
        activeBreakMinutes(activeEntry, now)
      const { data, error } = await supabase
        .from('ops_timesheet_entries')
        .update({
          clock_state: 'active',
          break_started_at: null,
          break_minutes: breakMinutes,
          updated_by: access.id,
          updated_at: now.toISOString(),
        })
        .eq('id', activeEntry.id)
        .select(
          'id, staff_user_id, work_date, started_at, ended_at, break_minutes, payable_minutes, hourly_rate, gross_pay, work_type, status, source, notes, clock_state, break_started_at',
        )
        .single()

      if (error) throw error
      return NextResponse.json({
        entry: serializeEntry(data as TimesheetEntry),
      })
    }

    if (action === 'clock_out') {
      const breakMinutes =
        Number(activeEntry.break_minutes || 0) +
        activeBreakMinutes(activeEntry, now)
      const payableMinutes = Math.max(
        0,
        minutesBetween(activeEntry.started_at, now) - breakMinutes,
      )
      const endedAt =
        now.getTime() > new Date(activeEntry.started_at).getTime()
          ? now.toISOString()
          : addOneMinute(new Date(activeEntry.started_at))

      const { data, error } = await supabase
        .from('ops_timesheet_entries')
        .update({
          ended_at: endedAt,
          break_minutes: breakMinutes,
          payable_minutes: payableMinutes,
          clock_state: 'complete',
          break_started_at: null,
          notes: null,
          updated_by: access.id,
          updated_at: now.toISOString(),
        })
        .eq('id', activeEntry.id)
        .select(
          'id, staff_user_id, work_date, started_at, ended_at, break_minutes, payable_minutes, hourly_rate, gross_pay, work_type, status, source, notes, clock_state, break_started_at',
        )
        .single()

      if (error) throw error
      return NextResponse.json({
        entry: serializeEntry(data as TimesheetEntry),
      })
    }

    return jsonError('Unsupported time clock action', 400)
  } catch (error) {
    console.error('[tech/time-clock][POST]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return jsonError('Failed to update time clock', status)
  }
}
