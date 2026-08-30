import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { scheduleQueuedVisit } from '@/lib/ops/restoration-projects'

/** Place a queued monitor visit on the calendar (tray drop or tap-to-place). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const appointmentDate = String(body.appointment_date ?? '')
    const startTime = String(body.start_time ?? '')
    if (!appointmentDate || !startTime) {
      return NextResponse.json(
        { error: 'appointment_date and start_time are required' },
        { status: 400 },
      )
    }

    const result = await scheduleQueuedVisit(supabase, {
      queueId: id,
      appointmentDate,
      startTime,
      assignedStaffUserId: body.assigned_staff_user_id ?? null,
    })

    if (!result.ok) {
      const status = result.error.endsWith('_not_found')
        ? 404
        : result.error.endsWith('_not_open') || result.error.endsWith('_not_active')
          ? 409
          : 500
      return NextResponse.json({ error: result.error }, { status })
    }

    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to schedule visit'
    const status = message === 'Not authorized' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
