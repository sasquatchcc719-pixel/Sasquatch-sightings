import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  executeAtomicEstimateConversion,
  prepareEstimateConversion,
} from '@/lib/ops/estimate-conversion'
import { createAdminClient } from '@/supabase/server'

/**
 * Convert an estimate into a booked service appointment and draft invoice.
 * The core records are created by one transactional database function. External
 * lifecycle communications and QuickBooks follow-up run only after commit.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const supabase = createAdminClient()
    const { id: estimateId } = await params
    const body = await request.json()

    const appointmentDate = String(body.appointment_date || '').trim()
    const startTime = String(body.start_time || '').trim()
    const assignedStaffUserId = String(body.assigned_staff_user_id || '').trim()
    if (!appointmentDate || !startTime || !assignedStaffUserId) {
      return NextResponse.json(
        {
          error:
            'appointment_date, start_time, and assigned_staff_user_id are required',
        },
        { status: 400 },
      )
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate) ||
      !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(startTime)
    ) {
      return NextResponse.json(
        { error: 'Choose a valid service date and start time.' },
        { status: 400 },
      )
    }

    const allowConflict = body.allow_conflict === true
    const runFollowUps = body.skip_comms !== true
    const prepared = await prepareEstimateConversion({
      supabase,
      estimateId,
      appointmentDate,
      startTime,
      endTime: body.end_time ? String(body.end_time) : null,
      assignedStaffUserId,
      discountAmount: Number(body.discount_amount || 0),
      allowConflict,
      notifyCustomer: runFollowUps,
      syncQuickBooks: runFollowUps,
    })
    const result = await executeAtomicEstimateConversion({
      supabase,
      prepared,
      actorId: access.id,
      allowConflict,
      notifyCustomer: runFollowUps,
      syncQuickBooks: runFollowUps,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error('[ops/estimates/:id/convert][POST] Error:', error)
    const message =
      error instanceof Error ? error.message : 'Failed to convert estimate'
    const conflict =
      /already been converted|changed after preview|changed during conversion|overlaps/i.test(
        message,
      )
    return NextResponse.json(
      { error: message },
      { status: conflict ? 409 : 400 },
    )
  }
}
