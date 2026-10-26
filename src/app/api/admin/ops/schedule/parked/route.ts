import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { normalizePhone } from '@/lib/blacklist'

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
         ops_customers!ops_appointments_customer_id_fkey ( full_name, business_name, phone, email, email_opt_out ),
         ops_service_addresses ( street_1, city )`,
      )
      .not('parked_at', 'is', null)
      .order('parked_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(50)

    if (error) throw error

    const phones = [
      ...new Set(
        (data ?? [])
          .map((job) => {
            const customer = Array.isArray(job.ops_customers)
              ? job.ops_customers[0]
              : job.ops_customers
            return normalizePhone(customer?.phone ?? '')
          })
          .filter((phone) => phone.length === 10),
      ),
    ]
    const blacklist = phones.length
      ? await supabase.from('blacklist').select('phone').in('phone', phones)
      : { data: [], error: null }
    if (blacklist.error) throw blacklist.error
    const blocked = new Set(
      (blacklist.data ?? []).map((row) => normalizePhone(row.phone)),
    )

    return NextResponse.json({
      appointments: (data ?? []).map((job) => ({
        ...job,
        contact: (() => {
          const customer = Array.isArray(job.ops_customers)
            ? job.ops_customers[0]
            : job.ops_customers
          return {
            phone: customer?.phone ?? null,
            email: customer?.email ?? null,
            blocked: blocked.has(normalizePhone(customer?.phone ?? '')),
            emailOptOut: Boolean(customer?.email_opt_out),
          }
        })(),
        // Keep the length it was booked for, so replacing it does not silently
        // shrink a four-hour job to a default.
        duration_minutes: durationMinutes(job.start_time, job.end_time),
      })),
    })
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Failed to load parked jobs'
    return NextResponse.json(
      { error: message },
      { status: message === 'Not authorized' ? 403 : 500 },
    )
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
