import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * Jobs taken off the schedule but not given up on.
 *
 * These sit in the tray until a new slot is chosen. They keep their customer,
 * address, line items and invoice — only the date has been withdrawn.
 */
export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('ops_appointments')
      .select(
        `id, appointment_date, start_time, end_time, quoted_total, kind,
         ops_customers!ops_appointments_customer_id_fkey ( full_name, business_name ),
         ops_service_addresses ( street_1, city )`,
      )
      .not('parked_at', 'is', null)
      .order('parked_at', { ascending: true })
      .limit(50)

    if (error) throw error

    return NextResponse.json({
      appointments: (data ?? []).map((job) => ({
        ...job,
        // Keep the length it was booked for, so replacing it does not silently
        // shrink a four-hour job to a default.
        duration_minutes: durationMinutes(job.start_time, job.end_time),
      })),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load parked jobs'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}

function durationMinutes(start: string | null, end: string | null): number {
  const toMinutes = (value: string | null) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(value ?? '')
    return m ? Number(m[1]) * 60 + Number(m[2]) : null
  }
  const from = toMinutes(start)
  const to = toMinutes(end)
  if (from == null || to == null || to <= from) return 120
  return to - from
}
