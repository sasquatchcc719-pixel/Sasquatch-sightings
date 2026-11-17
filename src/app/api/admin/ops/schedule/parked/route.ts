import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { normalizePhone } from '@/lib/blacklist'
import {
  projectUnscheduledFollowUp,
  saveUnscheduledFollowUp,
  saveUnscheduledFollowUpInput,
} from '@/lib/ops/unscheduled-follow-up'

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
        `id, appointment_date, start_time, end_time, quoted_total, kind, internal_notes,
         lead_source, lead_source_key, lead_source_detail, original_lead_source, booking_channel, source,
         follow_up:ops_unscheduled_follow_ups (next_follow_up_date, next_follow_up_time, reviewed_at, review_note, updated_at, resolved_at),
         ops_customers!ops_appointments_customer_id_fkey ( full_name, business_name, phone, email, email_opt_out ),
         ops_service_addresses ( street_1, street_2, city, state, zip_code ),
         ops_appointment_line_items ( id, name_snapshot, quantity, unit_price, line_total, duration_minutes, notes ),
         ops_invoices ( id, invoice_number, status, payment_status, subtotal, discount_amount, percentage_discount_amount, minimum_charge_adjustment, total )`,
      )
      .not('parked_at', 'is', null)
      .order('parked_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(50)

    if (error) throw error

    const appointmentIds = (data ?? []).map((job) => job.id)
    const convertedEstimates = appointmentIds.length
      ? await supabase
          .from('ops_appointments')
          .select('id, converted_appointment_id')
          .eq('kind', 'estimate')
          .in('converted_appointment_id', appointmentIds)
      : { data: [], error: null }
    if (convertedEstimates.error) throw convertedEstimates.error
    const estimateByAppointment = new Map(
      (convertedEstimates.data ?? []).map((estimate) => [
        estimate.converted_appointment_id,
        estimate.id,
      ]),
    )

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
        converted_from_estimate_id: estimateByAppointment.get(job.id) ?? null,
        follow_up: projectUnscheduledFollowUp(job.follow_up),
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

export async function PATCH(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const input = saveUnscheduledFollowUpInput.safeParse(await request.json())
    if (!input.success)
      return NextResponse.json(
        { error: 'Invalid follow-up date or version' },
        { status: 400 },
      )
    const follow_up = await saveUnscheduledFollowUp(
      createAdminClient(),
      input.data,
      access.id,
      access.staff?.display_name || access.email || 'Staff',
    )
    return NextResponse.json({ follow_up })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to save follow-up'
    return NextResponse.json(
      { error: message },
      {
        status:
          message === 'Not authorized'
            ? 403
            : message.includes('Refresh')
              ? 409
              : message.startsWith('Choose today')
                ? 400
                : 500,
      },
    )
  }
}
