import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { mountainDateKey } from '@/lib/ops/timesheet-pay'
import {
  AFTER_HOURS_PREMIUM_RATE,
  computeAfterHoursMinutes,
  computePremiumPay,
  isRecoveryVillage,
} from '@/lib/ops/after-hours-premium'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function unwrap<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

type ApprovedTimesheetEndMap = Map<string, string>

function approvedTimesheetEndKey(staffUserId: string, workDate: string) {
  return `${staffUserId}:${workDate}`
}

function capToApprovedTimesheetEnd(
  completedAt: string | null | undefined,
  approvedTimesheetEnd: string | null | undefined,
): string | null | undefined {
  if (!completedAt || !approvedTimesheetEnd) return completedAt
  return new Date(approvedTimesheetEnd).getTime() <
    new Date(completedAt).getTime()
    ? approvedTimesheetEnd
    : completedAt
}

async function loadApprovedTimesheetEnds(
  supabase: ReturnType<typeof createAdminClient>,
  staffIds: string[],
  startDate: string,
  endDate: string,
): Promise<ApprovedTimesheetEndMap> {
  const ends: ApprovedTimesheetEndMap = new Map()
  if (staffIds.length === 0) return ends

  const { data, error } = await supabase
    .from('ops_timesheet_entries')
    .select('staff_user_id, work_date, ended_at')
    .in('staff_user_id', staffIds)
    .gte('work_date', startDate)
    .lte('work_date', endDate)
    .eq('clock_state', 'complete')
    .not('ended_at', 'is', null)

  if (error) throw error

  for (const entry of data || []) {
    const key = approvedTimesheetEndKey(entry.staff_user_id, entry.work_date)
    const existing = ends.get(key)
    if (
      !existing ||
      new Date(entry.ended_at).getTime() > new Date(existing).getTime()
    ) {
      ends.set(key, entry.ended_at)
    }
  }

  return ends
}

type QualifyingJob = {
  appointmentId: string
  workDate: string
  staffUserId: string
  staffName: string
  jobStartedAt: string
  completedAt: string
  customerName: string
  minutes: number
  premiumRate: number
  premiumPay: number
}

/**
 * Find completed Recovery Village jobs, assigned to a field tech, whose real
 * worked window (Start Job -> Complete) ran past 5pm, within a date range.
 */
async function findQualifyingJobs(
  supabase: ReturnType<typeof createAdminClient>,
  startDate: string,
  endDate: string,
): Promise<QualifyingJob[]> {
  const { data, error } = await supabase
    .from('ops_appointments')
    .select(
      `
        id,
        appointment_date,
        job_started_at,
        completed_at,
        assigned_staff_user_id,
        ops_customers!ops_appointments_customer_id_fkey (
          business_name,
          full_name
        )
      `,
    )
    .eq('status', 'completed')
    .gte('appointment_date', startDate)
    .lte('appointment_date', endDate)
    .not('job_started_at', 'is', null)
    .not('completed_at', 'is', null)
    .not('assigned_staff_user_id', 'is', null)

  if (error) throw error
  const rows = data || []

  const staffIds = [
    ...new Set(rows.map((r) => r.assigned_staff_user_id).filter(Boolean)),
  ]
  const staffById = new Map<string, { display_name: string; role: string }>()
  if (staffIds.length > 0) {
    const { data: staff } = await supabase
      .from('staff_users')
      .select('id, display_name, role')
      .in('id', staffIds as string[])
    for (const s of staff || []) {
      staffById.set(s.id, { display_name: s.display_name, role: s.role })
    }
  }
  const approvedEnds = await loadApprovedTimesheetEnds(
    supabase,
    staffIds as string[],
    startDate,
    endDate,
  )

  const jobs: QualifyingJob[] = []
  for (const row of rows) {
    const customer = unwrap(row.ops_customers)
    if (!isRecoveryVillage(customer?.business_name)) continue

    const staff = staffById.get(row.assigned_staff_user_id as string)
    // Premium is for the field tech, never the owner doing the job himself.
    if (!staff || staff.role !== 'tech') continue

    const workDate = mountainDateKey(row.job_started_at as string)
    const effectiveCompletedAt = capToApprovedTimesheetEnd(
      row.completed_at,
      approvedEnds.get(
        approvedTimesheetEndKey(row.assigned_staff_user_id as string, workDate),
      ),
    )
    const minutes = computeAfterHoursMinutes(
      row.job_started_at,
      effectiveCompletedAt,
    )
    if (minutes <= 0) continue

    jobs.push({
      appointmentId: row.id,
      workDate,
      staffUserId: row.assigned_staff_user_id as string,
      staffName: staff.display_name,
      jobStartedAt: row.job_started_at as string,
      completedAt: effectiveCompletedAt as string,
      customerName:
        customer?.business_name?.trim() ||
        customer?.full_name ||
        'Recovery Village',
      minutes,
      premiumRate: AFTER_HOURS_PREMIUM_RATE,
      premiumPay: computePremiumPay(minutes),
    })
  }
  return jobs
}

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate') || ''
    const endDate = searchParams.get('endDate') || ''
    if (!startDate || !endDate || startDate > endDate) {
      return jsonError('A valid startDate and endDate are required', 400)
    }

    const jobs = await findQualifyingJobs(supabase, startDate, endDate)

    const appointmentIds = jobs.map((j) => j.appointmentId)
    const appliedByAppointment = new Map<
      string,
      {
        id: string
        status: string
        premium_pay: number
        premium_minutes: number
      }
    >()
    if (appointmentIds.length > 0) {
      const { data: applied } = await supabase
        .from('ops_after_hours_premiums')
        .select('id, appointment_id, status, premium_pay, premium_minutes')
        .in('appointment_id', appointmentIds)
      for (const p of applied || []) {
        appliedByAppointment.set(p.appointment_id, {
          id: p.id,
          status: p.status,
          premium_pay: Number(p.premium_pay || 0),
          premium_minutes: Number(p.premium_minutes || 0),
        })
      }
    }

    const premiums = jobs.map((job) => {
      const applied = appliedByAppointment.get(job.appointmentId)
      return {
        ...job,
        applied: Boolean(applied),
        premiumId: applied?.id ?? null,
        status: applied?.status ?? null,
        // Show the snapshotted pay once applied, the live computation otherwise.
        appliedPay: applied?.premium_pay ?? null,
        appliedMinutes: applied?.premium_minutes ?? null,
      }
    })

    const totalAppliedPay = premiums
      .filter((p) => p.applied)
      .reduce((sum, p) => sum + Number(p.appliedPay || 0), 0)

    return NextResponse.json({
      startDate,
      endDate,
      premiums,
      totalAppliedPay: Math.round(totalAppliedPay * 100) / 100,
    })
  } catch (error) {
    console.error('[payroll/after-hours-premiums][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return jsonError('Failed to load after-hours premiums', status)
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))
    const appointmentId = String(body.appointmentId || '')
    if (!appointmentId) return jsonError('appointmentId is required', 400)

    const { data: appt, error } = await supabase
      .from('ops_appointments')
      .select(
        `
          id, appointment_date, status, job_started_at, completed_at,
          assigned_staff_user_id,
          ops_customers!ops_appointments_customer_id_fkey ( business_name )
        `,
      )
      .eq('id', appointmentId)
      .maybeSingle()
    if (error) throw error
    if (!appt) return jsonError('Job not found', 404)

    // Re-validate everything server-side; never trust the client's numbers.
    if (appt.status !== 'completed') {
      return jsonError('Job is not completed', 400)
    }
    const customer = unwrap(appt.ops_customers)
    if (!isRecoveryVillage(customer?.business_name)) {
      return jsonError('Job is not a Recovery Village job', 400)
    }
    if (!appt.assigned_staff_user_id) {
      return jsonError('Job has no assigned tech', 400)
    }
    const { data: staff } = await supabase
      .from('staff_users')
      .select('id, role')
      .eq('id', appt.assigned_staff_user_id)
      .maybeSingle()
    if (!staff || staff.role !== 'tech') {
      return jsonError('Premium applies only to field techs', 400)
    }
    const workDate = mountainDateKey(appt.job_started_at as string)
    const approvedEnds = await loadApprovedTimesheetEnds(
      supabase,
      [appt.assigned_staff_user_id],
      workDate,
      workDate,
    )
    const effectiveCompletedAt = capToApprovedTimesheetEnd(
      appt.completed_at,
      approvedEnds.get(
        approvedTimesheetEndKey(appt.assigned_staff_user_id, workDate),
      ),
    )
    const minutes = computeAfterHoursMinutes(
      appt.job_started_at,
      effectiveCompletedAt,
    )
    if (minutes <= 0) {
      return jsonError('Job has no worked time after 5pm', 400)
    }

    const { data: premium, error: upsertError } = await supabase
      .from('ops_after_hours_premiums')
      .upsert(
        {
          appointment_id: appointmentId,
          staff_user_id: appt.assigned_staff_user_id,
          work_date: workDate,
          premium_minutes: minutes,
          premium_rate: AFTER_HOURS_PREMIUM_RATE,
          status: 'approved',
          created_by: access.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'appointment_id' },
      )
      .select()
      .single()
    if (upsertError) throw upsertError

    return NextResponse.json({ premium }, { status: 201 })
  } catch (error) {
    console.error('[payroll/after-hours-premiums][POST]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return jsonError('Failed to apply premium', status)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))
    const id = String(body.id || '')
    const minutes = Number(body.premiumMinutes)

    if (!id) return jsonError('id is required', 400)
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
      return jsonError(
        'premiumMinutes must be a whole number from 0 to 1440',
        400,
      )
    }

    const { data: premium, error } = await supabase
      .from('ops_after_hours_premiums')
      .update({
        premium_minutes: minutes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .neq('status', 'paid')
      .select()
      .maybeSingle()

    if (error) throw error
    if (!premium) return jsonError('Editable premium was not found', 404)

    return NextResponse.json({ premium })
  } catch (error) {
    console.error('[payroll/after-hours-premiums][PATCH]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return jsonError('Failed to update premium', status)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const appointmentId = searchParams.get('appointmentId')
    if (!id && !appointmentId) {
      return jsonError('id or appointmentId is required', 400)
    }

    let query = supabase
      .from('ops_after_hours_premiums')
      .delete()
      .neq('status', 'paid')
    query = id
      ? query.eq('id', id)
      : query.eq('appointment_id', appointmentId as string)

    const { error } = await query
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[payroll/after-hours-premiums][DELETE]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return jsonError('Failed to remove premium', status)
  }
}
