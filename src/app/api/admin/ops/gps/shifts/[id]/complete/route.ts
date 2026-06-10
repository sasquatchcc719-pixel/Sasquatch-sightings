import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  completeGpsShift,
  GpsShiftCompletionError,
} from '@/lib/ops/gps-shift-completion'
import { mountainLocalDateTimeToIso } from '@/lib/ops/timesheet-pay'
import { createAdminClient } from '@/supabase/server'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole(['admin', 'owner'])
    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const endedAt = mountainLocalDateTimeToIso(
      String(body.date || ''),
      String(body.time || ''),
    )

    if (!endedAt) {
      return NextResponse.json(
        { error: 'Enter a valid Mountain Time clock-out date and time' },
        { status: 400 },
      )
    }

    const result = await completeGpsShift({
      supabase: createAdminClient(),
      shiftId: id,
      endedAt,
      actorUserId: access.id,
      notes: `Clocked out manually by ${access.role}.`,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[gps/shifts/[id]/complete][POST]', error)
    const unauthorized =
      error instanceof Error && error.message === 'Not authorized'
    const status = unauthorized
      ? 401
      : error instanceof GpsShiftCompletionError
        ? error.status
        : 500
    const message =
      error instanceof GpsShiftCompletionError
        ? error.message
        : unauthorized
          ? 'Not authorized'
          : 'Failed to complete shift'

    return NextResponse.json({ error: message }, { status })
  }
}
