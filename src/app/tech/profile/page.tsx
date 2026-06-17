import { TechProfilePhotoForm } from '@/components/tech/tech-profile-photo-form'
import { requireAnyRole } from '@/lib/auth'
import {
  getSemiMonthlyPayPeriod,
  mountainDateKey,
} from '@/lib/ops/timesheet-pay'
import { createAdminClient } from '@/supabase/server'

export default async function TechProfilePage() {
  const access = await requireAnyRole(['admin', 'owner', 'tech'])

  if (!access.staff) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-6">
        <h1 className="text-2xl font-bold">Profile unavailable</h1>
        <p className="mt-2 text-sm text-slate-400">
          This account is not connected to a technician profile yet.
        </p>
      </section>
    )
  }

  const supabase = createAdminClient()
  const todayKey = mountainDateKey(new Date())
  const payPeriod = getSemiMonthlyPayPeriod(todayKey)
  const { data: staff, error } = await supabase
    .from('staff_users')
    .select('id, display_name, role, profile_image_url')
    .eq('id', access.staff.id)
    .eq('user_id', access.id)
    .maybeSingle()

  if (error) throw error

  const staffUserId = staff?.id || access.staff.id
  const [
    { data: timesheetEntries, error: timesheetError },
    { data: activeShift, error: activeShiftError },
  ] = await Promise.all([
    supabase
      .from('ops_timesheet_entries')
      .select(
        'id, work_date, started_at, ended_at, break_minutes, payable_minutes, work_type, status',
      )
      .eq('staff_user_id', staffUserId)
      .gte('work_date', payPeriod.startDate)
      .lte('work_date', payPeriod.endDate)
      .order('work_date', { ascending: false })
      .order('started_at', { ascending: false }),
    supabase
      .from('gps_shifts')
      .select('id, started_at, break_started_at, break_minutes')
      .eq('user_id', access.id)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (timesheetError) throw timesheetError
  if (activeShiftError) throw activeShiftError

  return (
    <TechProfilePhotoForm
      displayName={staff?.display_name || access.staff.display_name}
      role={staff?.role || access.staff.role}
      initialImageUrl={staff?.profile_image_url || null}
      payPeriod={{
        startDate: payPeriod.startDate,
        endDate: payPeriod.endDate,
        label: payPeriod.label,
        entries: (timesheetEntries || []).map((entry) => ({
          id: entry.id,
          workDate: entry.work_date,
          startedAt: entry.started_at,
          endedAt: entry.ended_at,
          breakMinutes: Number(entry.break_minutes || 0),
          payableMinutes: Number(entry.payable_minutes || 0),
          workType: entry.work_type || 'job',
          status: entry.status || 'draft',
        })),
        activeShift: activeShift
          ? {
              id: activeShift.id,
              startedAt: activeShift.started_at,
              breakStartedAt: activeShift.break_started_at || null,
              breakMinutes: Number(activeShift.break_minutes || 0),
            }
          : null,
      }}
    />
  )
}
