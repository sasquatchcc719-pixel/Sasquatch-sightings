import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { getAssignedTechAppointment } from '@/lib/tech/appointments'
import { createAdminClient } from '@/supabase/server'
import { suppressPostJobReviewRequest } from '@/lib/ops/review-requests'
import { enrollCustomerInDrip } from '@/lib/ops/drip-campaign'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const { id } = await params
    const staffUserId = access.staff?.id ?? access.id
    const appointment = await getAssignedTechAppointment(
      supabase,
      staffUserId,
      id,
    )

    if (!appointment) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    return NextResponse.json({ appointment })
  } catch (error) {
    console.error('[tech/appointments/:id][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'Failed to load job' },
      { status },
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const { id } = await params
    const body = await request.json()
    const staffUserId = access.staff?.id ?? access.id
    const current = await getAssignedTechAppointment(supabase, staffUserId, id)

    if (!current) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const allowedStatuses = new Set([
      'booked',
      'confirmed',
      'on_my_way',
      'in_progress',
      'completed',
    ])
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (body.status !== undefined) {
      const status = String(body.status)
      if (!allowedStatuses.has(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      updates.status = status
      if (status === 'on_my_way')
        updates.on_my_way_at = new Date().toISOString()
      if (
        current.status === 'on_my_way' &&
        (status === 'booked' || status === 'confirmed')
      )
        updates.on_my_way_at = null
      // "Start Job" tap — records the real worked-window start (used for the
      // Recovery Village after-hours premium). Stamp on each entry into
      // in_progress so the most recent start wins.
      if (status === 'in_progress')
        updates.job_started_at = new Date().toISOString()
      if (status === 'completed')
        updates.completed_at = new Date().toISOString()
    }

    const skipCustomerCommunications =
      body.skip_customer_communications === true

    if (body.internal_notes !== undefined) {
      updates.internal_notes = String(body.internal_notes || '').trim() || null
    }

    const { error: updateError } = await supabase
      .from('ops_appointments')
      .update(updates)
      .eq('id', id)
      .eq('assigned_staff_user_id', staffUserId)

    if (updateError) throw updateError

    if (body.status === 'completed' && current.status !== 'completed') {
      await enrollCustomerInDrip(id)
    }

    if (body.status !== undefined) {
      await supabase.from('ops_appointment_status_events').insert({
        appointment_id: id,
        from_status: current.status,
        to_status: String(body.status),
        changed_by: access.id,
        notes: 'Updated from tech portal',
      })

      if (String(body.status) === 'completed' && skipCustomerCommunications) {
        await suppressPostJobReviewRequest(
          supabase,
          id,
          'manual quiet close - post-job communications skipped',
        )
      }
    }

    const appointment = await getAssignedTechAppointment(
      supabase,
      staffUserId,
      id,
    )
    return NextResponse.json({ appointment })
  } catch (error) {
    console.error('[tech/appointments/:id][PATCH]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'Failed to update job' },
      { status },
    )
  }
}
