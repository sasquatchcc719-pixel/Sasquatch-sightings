import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { notifyDavidShiftEvent } from '@/lib/ops/gps-shift-notifications'
import { createAdminClient } from '@/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))
    const shiftId = body.shiftId ? String(body.shiftId) : null

    let shiftQuery = supabase
      .from('gps_shifts')
      .select('id, started_at, break_started_at, break_minutes')
      .eq('user_id', access.id)
      .eq('status', 'active')

    if (shiftId) shiftQuery = shiftQuery.eq('id', shiftId)

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

    if (shift.break_started_at) return NextResponse.json({ shift })

    const { data: updated, error: updateError } = await supabase
      .from('gps_shifts')
      .update({ break_started_at: new Date().toISOString() })
      .eq('id', shift.id)
      .eq('status', 'active')
      .is('break_started_at', null)
      .select('id, started_at, break_started_at, break_minutes')
      .maybeSingle()

    if (updateError) throw updateError
    if (!updated) {
      return NextResponse.json(
        { error: 'Break is already active or shift was closed' },
        { status: 409 },
      )
    }

    await notifyDavidShiftEvent({
      staff: access.staff,
      event: 'break_start',
      shift: updated,
    })

    return NextResponse.json({ shift: updated })
  } catch (error) {
    console.error('[gps/shifts/break/start][POST]', error)
    return NextResponse.json(
      { error: 'Failed to start break' },
      { status: 500 },
    )
  }
}
