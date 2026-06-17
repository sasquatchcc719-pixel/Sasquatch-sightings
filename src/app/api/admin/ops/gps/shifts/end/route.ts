import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { notifyDavidShiftEvent } from '@/lib/ops/gps-shift-notifications'
import {
  completeGpsShift,
  GpsShiftCompletionError,
} from '@/lib/ops/gps-shift-completion'
import { createAdminClient } from '@/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))

    const shiftId = body.shiftId ? String(body.shiftId) : null

    // Find the shift to close (use provided id or the latest active one)
    let shiftQuery = supabase
      .from('gps_shifts')
      .select('id, started_at, user_id')
      .eq('user_id', access.id)
      .eq('status', 'active')

    if (shiftId) {
      shiftQuery = shiftQuery.eq('id', shiftId)
    }

    const { data: shift, error: findError } = await shiftQuery
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (findError) throw findError
    if (!shift) {
      return NextResponse.json(
        { error: 'No active shift found' },
        { status: 404 },
      )
    }

    const result = await completeGpsShift({
      supabase,
      shiftId: shift.id,
      endedAt: new Date().toISOString(),
      actorUserId: access.id,
    })
    await notifyDavidShiftEvent({
      staff: access.staff,
      event: 'clock_out',
      shift: result.shift,
      payrollEntry: result.payrollEntry,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[gps/shifts/end][POST]', error)
    const status = error instanceof GpsShiftCompletionError ? error.status : 500
    const message =
      error instanceof GpsShiftCompletionError
        ? error.message
        : 'Failed to end shift'
    return NextResponse.json({ error: message }, { status })
  }
}
