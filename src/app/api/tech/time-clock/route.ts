import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { notifyDavidShiftEvent } from '@/lib/ops/gps-shift-notifications'
import { mountainDateKey } from '@/lib/ops/timesheet-pay'
import { createAdminClient } from '@/supabase/server'

const DEFAULT_HOURLY_RATE = 22
const RECENT_CLOCK_OUT_GRACE_MS = 90_000
// A tech can reopen their own shift for this long after a clock out. Long
// enough to notice "wait, I'm clocked out?" at the next job, short enough that
// it can't be used to quietly stretch a finished day.
const UNDO_CLOCK_OUT_WINDOW_MS = 10 * 60_000

type ClockState = 'active' | 'on_break' | 'complete'
type ClockAction =
  | 'clock_in'
  | 'clock_out'
  | 'undo_clock_out'
  | 'start_break'
  | 'end_break'

const CLOCK_ACTIONS = new Set<ClockAction>([
  'clock_in',
  'clock_out',
  'undo_clock_out',
  'start_break',
  'end_break',
])

const ENTRY_COLUMNS =
  'id, staff_user_id, work_date, started_at, ended_at, break_minutes, payable_minutes, hourly_rate, gross_pay, work_type, status, source, notes, clock_state, break_started_at'

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

type Supabase = ReturnType<typeof createAdminClient>

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

/**
 * The most recent completed entry, if it ended recently enough that the tech
 * can still undo it. Lets the portal show "Clocked out at 10:40 — Undo".
 */
function serializeRecentClockOut(entry: TimesheetEntry | null, now: Date) {
  if (!entry || entry.clock_state !== 'complete') return null
  const endedMs = new Date(entry.ended_at).getTime()
  if (!Number.isFinite(endedMs)) return null
  const age = now.getTime() - endedMs
  if (age < 0 || age >= UNDO_CLOCK_OUT_WINDOW_MS) return null
  return {
    id: entry.id,
    startedAt: entry.started_at,
    endedAt: entry.ended_at,
    payableMinutes: Number(entry.payable_minutes || 0),
    canUndoUntil: new Date(endedMs + UNDO_CLOCK_OUT_WINDOW_MS).toISOString(),
    clockInAllowedAt: new Date(
      endedMs + RECENT_CLOCK_OUT_GRACE_MS,
    ).toISOString(),
  }
}

async function getActiveEntry(supabase: Supabase, staffUserId: string) {
  const { data, error } = await supabase
    .from('ops_timesheet_entries')
    .select(ENTRY_COLUMNS)
    .eq('staff_user_id', staffUserId)
    .in('clock_state', ['active', 'on_break'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data as TimesheetEntry | null
}

async function getLatestCompletedEntry(
  supabase: Supabase,
  staffUserId: string,
) {
  const { data, error } = await supabase
    .from('ops_timesheet_entries')
    .select(ENTRY_COLUMNS)
    .eq('staff_user_id', staffUserId)
    .eq('clock_state', 'complete')
    .order('ended_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data as TimesheetEntry | null
}

async function getHourlyRate(supabase: Supabase, staffUserId: string) {
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

type RequestMeta = {
  userAgent: string | null
  ip: string | null
  clientSentAt: string | null
}

function requestMeta(request: NextRequest, body: Record<string, unknown>) {
  const forwarded = request.headers.get('x-forwarded-for')
  const clientSentAt =
    typeof body.clientSentAt === 'string' &&
    Number.isFinite(new Date(body.clientSentAt).getTime())
      ? new Date(body.clientSentAt).toISOString()
      : null
  return {
    userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
    ip: forwarded ? forwarded.split(',')[0].trim().slice(0, 100) : null,
    clientSentAt,
  } satisfies RequestMeta
}

/**
 * Append-only audit row. Never throws: losing an audit line must not turn a
 * successful clock action into an error on the tech's phone.
 */
async function logClockEvent(
  supabase: Supabase,
  params: {
    staffUserId: string
    actorUserId: string
    entryId: string | null
    action: string
    result: 'ok' | 'rejected' | 'error'
    message: string | null
    meta: RequestMeta
  },
) {
  try {
    const action = CLOCK_ACTIONS.has(params.action as ClockAction)
      ? params.action
      : null
    if (!action) return
    const { error } = await supabase.from('ops_time_clock_events').insert({
      staff_user_id: params.staffUserId,
      actor_user_id: params.actorUserId,
      entry_id: params.entryId,
      action,
      result: params.result,
      message: params.message,
      client_sent_at: params.meta.clientSentAt,
      user_agent: params.meta.userAgent,
      ip: params.meta.ip,
    })
    if (error) console.error('[tech/time-clock] audit insert failed', error)
  } catch (error) {
    console.error('[tech/time-clock] audit insert threw', error)
  }
}

async function statusPayload(supabase: Supabase, staffUserId: string) {
  const now = new Date()
  const [active, latestCompleted] = await Promise.all([
    getActiveEntry(supabase, staffUserId),
    getLatestCompletedEntry(supabase, staffUserId),
  ])
  return {
    entry: serializeEntry(active),
    recentClockOut: active
      ? null
      : serializeRecentClockOut(latestCompleted, now),
    serverTime: now.toISOString(),
  }
}

export async function GET() {
  try {
    const access = await requireAnyRole(['tech', 'owner', 'admin'])
    if (!access.staff) {
      return NextResponse.json(
        { error: 'Staff record was not found' },
        { status: 404 },
      )
    }

    const supabase = createAdminClient()
    return NextResponse.json(await statusPayload(supabase, access.staff.id))
  } catch (error) {
    console.error('[tech/time-clock][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: 'Failed to load time clock status' },
      { status },
    )
  }
}

export async function POST(request: NextRequest) {
  let supabase: Supabase | null = null
  let staffUserId: string | null = null
  let actorUserId: string | null = null
  let action = ''
  let meta: RequestMeta = { userAgent: null, ip: null, clientSentAt: null }

  try {
    const access = await requireAnyRole(['tech', 'owner', 'admin'])
    if (!access.staff) {
      return NextResponse.json(
        { error: 'Staff record was not found' },
        { status: 404 },
      )
    }

    supabase = createAdminClient()
    staffUserId = access.staff.id
    actorUserId = access.id
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >
    action = String(body.action || '')
    meta = requestMeta(request, body)
    const now = new Date()

    // Any rejection carries the real server state so the phone can resync
    // instead of staying stuck on whatever it last believed.
    const reject = async (message: string, status: number) => {
      await logClockEvent(supabase!, {
        staffUserId: staffUserId!,
        actorUserId: actorUserId!,
        entryId: null,
        action,
        result: 'rejected',
        message,
        meta,
      })
      const state = await statusPayload(supabase!, staffUserId!)
      return NextResponse.json({ error: message, ...state }, { status })
    }

    if (!CLOCK_ACTIONS.has(action as ClockAction)) {
      return NextResponse.json(
        { error: 'Unsupported time clock action' },
        { status: 400 },
      )
    }

    const activeEntry = await getActiveEntry(supabase, staffUserId)

    if (action === 'clock_in') {
      if (activeEntry) return reject('Already clocked in', 409)

      const latestCompletedEntry = await getLatestCompletedEntry(
        supabase,
        staffUserId,
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
        return reject(
          'You just clocked out. Use Undo to get back on the clock, or wait a minute to start a new shift.',
          409,
        )
      }

      const hourlyRate = await getHourlyRate(supabase, staffUserId)
      const { data, error } = await supabase
        .from('ops_timesheet_entries')
        .insert({
          staff_user_id: staffUserId,
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
          created_by: actorUserId,
          updated_by: actorUserId,
          clock_state: 'active',
          break_started_at: null,
        })
        .select(ENTRY_COLUMNS)
        .single()

      if (error) throw error
      const entry = data as TimesheetEntry
      await logClockEvent(supabase, {
        staffUserId,
        actorUserId,
        entryId: entry.id,
        action,
        result: 'ok',
        message: null,
        meta,
      })
      void notifyDavidShiftEvent({
        staff: access.staff,
        event: 'clock_in',
        shift: { id: entry.id, started_at: entry.started_at },
      }).catch((notifyError) =>
        console.error('[tech/time-clock] notify failed', notifyError),
      )
      return NextResponse.json({
        entry: serializeEntry(entry),
        recentClockOut: null,
        serverTime: now.toISOString(),
      })
    }

    if (action === 'undo_clock_out') {
      if (activeEntry) return reject('You are already clocked in', 409)

      const latest = await getLatestCompletedEntry(supabase, staffUserId)
      const recent = serializeRecentClockOut(latest, now)
      if (!latest || !recent) {
        return reject(
          'That clock out is too old to undo. Clock in to start a new shift and let Charles know.',
          409,
        )
      }
      if (latest.status !== 'draft') {
        return reject('That shift has already been approved for payroll', 409)
      }

      // Only reopen if nothing else touched the row in between (the
      // clock_state filter is the guard — an admin edit doesn't change it, and
      // a concurrent undo would flip it first).
      const { data, error } = await supabase
        .from('ops_timesheet_entries')
        .update({
          clock_state: 'active',
          break_started_at: null,
          ended_at: addOneMinute(now),
          payable_minutes: 0,
          notes: `Simple time clock entry. Clock out at ${latest.ended_at} was undone from tech portal.`,
          updated_by: actorUserId,
          updated_at: now.toISOString(),
        })
        .eq('id', latest.id)
        .eq('clock_state', 'complete')
        .select(ENTRY_COLUMNS)
        .maybeSingle()

      if (error) throw error
      if (!data)
        return reject('That shift changed. Reloading your status.', 409)

      const entry = data as TimesheetEntry
      await logClockEvent(supabase, {
        staffUserId,
        actorUserId,
        entryId: entry.id,
        action,
        result: 'ok',
        message: `Reopened; previous clock out was ${latest.ended_at}`,
        meta,
      })
      void notifyDavidShiftEvent({
        staff: access.staff,
        event: 'undo_clock_out',
        shift: { id: entry.id, started_at: entry.started_at },
      }).catch((notifyError) =>
        console.error('[tech/time-clock] notify failed', notifyError),
      )
      return NextResponse.json({
        entry: serializeEntry(entry),
        recentClockOut: null,
        serverTime: now.toISOString(),
      })
    }

    if (!activeEntry) {
      return reject('You are not clocked in right now', 404)
    }

    if (action === 'start_break') {
      if (activeEntry.clock_state === 'on_break') {
        return NextResponse.json({
          entry: serializeEntry(activeEntry),
          recentClockOut: null,
          serverTime: now.toISOString(),
        })
      }

      const { data, error } = await supabase
        .from('ops_timesheet_entries')
        .update({
          clock_state: 'on_break',
          break_started_at: now.toISOString(),
          updated_by: actorUserId,
          updated_at: now.toISOString(),
        })
        .eq('id', activeEntry.id)
        .select(ENTRY_COLUMNS)
        .single()

      if (error) throw error
      await logClockEvent(supabase, {
        staffUserId,
        actorUserId,
        entryId: activeEntry.id,
        action,
        result: 'ok',
        message: null,
        meta,
      })
      return NextResponse.json({
        entry: serializeEntry(data as TimesheetEntry),
        recentClockOut: null,
        serverTime: now.toISOString(),
      })
    }

    if (action === 'end_break') {
      if (activeEntry.clock_state !== 'on_break') {
        return NextResponse.json({
          entry: serializeEntry(activeEntry),
          recentClockOut: null,
          serverTime: now.toISOString(),
        })
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
          updated_by: actorUserId,
          updated_at: now.toISOString(),
        })
        .eq('id', activeEntry.id)
        .select(ENTRY_COLUMNS)
        .single()

      if (error) throw error
      await logClockEvent(supabase, {
        staffUserId,
        actorUserId,
        entryId: activeEntry.id,
        action,
        result: 'ok',
        message: `Break total ${breakMinutes}m`,
        meta,
      })
      return NextResponse.json({
        entry: serializeEntry(data as TimesheetEntry),
        recentClockOut: null,
        serverTime: now.toISOString(),
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
          updated_by: actorUserId,
          updated_at: now.toISOString(),
        })
        .eq('id', activeEntry.id)
        .select(ENTRY_COLUMNS)
        .single()

      if (error) throw error
      const entry = data as TimesheetEntry
      await logClockEvent(supabase, {
        staffUserId,
        actorUserId,
        entryId: entry.id,
        action,
        result: 'ok',
        message: `Payable ${payableMinutes}m, break ${breakMinutes}m`,
        meta,
      })
      void notifyDavidShiftEvent({
        staff: access.staff,
        event: 'clock_out',
        shift: {
          id: entry.id,
          started_at: entry.started_at,
          ended_at: entry.ended_at,
          break_minutes: breakMinutes,
        },
        payrollEntry: {
          payable_minutes: payableMinutes,
          break_minutes: breakMinutes,
        },
      }).catch((notifyError) =>
        console.error('[tech/time-clock] notify failed', notifyError),
      )
      return NextResponse.json({
        entry: null,
        recentClockOut: serializeRecentClockOut(entry, now),
        serverTime: now.toISOString(),
      })
    }

    return NextResponse.json(
      { error: 'Unsupported time clock action' },
      { status: 400 },
    )
  } catch (error) {
    console.error('[tech/time-clock][POST]', error)
    if (supabase && staffUserId && actorUserId) {
      await logClockEvent(supabase, {
        staffUserId,
        actorUserId,
        entryId: null,
        action,
        result: 'error',
        message: error instanceof Error ? error.message.slice(0, 500) : null,
        meta,
      })
    }
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: 'Failed to update time clock' },
      { status },
    )
  }
}
