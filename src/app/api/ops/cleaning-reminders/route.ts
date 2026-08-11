/**
 * Set / read / cancel a customer-requested cleaning reminder.
 *
 * Shared by both close-out surfaces: the admin invoice detail page and the
 * tech job screen. Techs are scoped to their own assigned jobs; admins and
 * owners can act on any job.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { getTechAppointmentForAccess } from '@/lib/tech/appointments'
import { createAdminClient } from '@/supabase/server'
import {
  cancelCleaningReminder,
  getReminderForAppointment,
  isValidInterval,
  setCleaningReminder,
} from '@/lib/ops/cleaning-reminders'

type Access = Awaited<ReturnType<typeof requireAnyRole>>

/**
 * Techs may only touch jobs assigned to them; admin/owner are unrestricted.
 * Returns true when the caller may act on this appointment.
 */
async function canAccessAppointment(
  supabase: ReturnType<typeof createAdminClient>,
  access: Access,
  appointmentId: string,
): Promise<boolean> {
  if (access.role === 'admin' || access.role === 'owner') return true
  const appointment = await getTechAppointmentForAccess(supabase, {
    role: access.role,
    staffId: access.staff?.id ?? access.id,
    appointmentId,
  })
  return !!appointment
}

export async function GET(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const appointmentId = request.nextUrl.searchParams.get('appointmentId')
    if (!appointmentId) {
      return NextResponse.json(
        { error: 'appointmentId is required' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    if (!(await canAccessAppointment(supabase, access, appointmentId))) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const reminder = await getReminderForAppointment(supabase, appointmentId)
    return NextResponse.json({ reminder })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to load reminder'
    const status = message === 'Not authorized' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const body = await request.json()
    const appointmentId = String(body?.appointmentId || '').trim()
    const months = Number(body?.months)

    if (!appointmentId) {
      return NextResponse.json(
        { error: 'appointmentId is required' },
        { status: 400 },
      )
    }
    if (!isValidInterval(months)) {
      return NextResponse.json(
        { error: 'months must be 3, 6, or 12' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    if (!(await canAccessAppointment(supabase, access, appointmentId))) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const result = await setCleaningReminder(supabase, {
      appointmentId,
      months,
      createdBy: access.id,
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to set reminder'
    const status = message === 'Not authorized' ? 403 : 400
    console.error('[cleaning-reminders] POST failed:', error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const reminderId = request.nextUrl.searchParams.get('id')
    if (!reminderId) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: reminder } = await supabase
      .from('cleaning_reminders')
      .select('id, appointment_id')
      .eq('id', reminderId)
      .maybeSingle()
    if (!reminder) {
      return NextResponse.json({ error: 'Reminder not found' }, { status: 404 })
    }
    if (
      reminder.appointment_id &&
      !(await canAccessAppointment(supabase, access, reminder.appointment_id))
    ) {
      return NextResponse.json({ error: 'Reminder not found' }, { status: 404 })
    }

    await cancelCleaningReminder(supabase, reminderId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to cancel reminder'
    const status = message === 'Not authorized' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
