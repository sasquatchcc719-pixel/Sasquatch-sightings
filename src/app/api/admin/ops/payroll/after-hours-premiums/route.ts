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

  const jobs: QualifyingJob[] = []
  for (const row of rows) {
    const customer = unwrap(row.ops_customers)
    if (!isRecoveryVillage(customer?.business_name)) continue

    const staff = staffById.get(row.assigned_staff_user_id as string)
    // Premium is for the field tech, never the owner doing the job himself.
    if (!staff || staff.role !== 'tech') continue

    const minutes = computeAfterHoursMinutes(
      row.job_started_at,
      row.completed_at,
    )
    if (minutes <= 0) continue

    jobs.push({
      appointmentId: row.id,
      workDate: mountainDateKey(row.job_started_at as string),
      staffUserId: row.assigned_staff_user_id as string,
      staffName: staff.display_name,
      jobStartedAt: row.job_started_at as string,
      completedAt: row.completed_at as string,
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
    const minutes = computeAfterHoursMinutes(
      appt.job_started_at,
      appt.completed_at,
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
          work_date: mountainDateKey(appt.job_started_at as string),
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
