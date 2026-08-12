/**
 * Admin review of fiber checks and work removed from invoices.
 * Read-only. This is the internal record Charles reviews when something could
 * not be cleaned — and the audit trail for money taken off an invoice.
 */

import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  const { data: checks, error } = await supabase
    .from('fiber_checks')
    .select(
      `
      id,
      appointment_id,
      appointment_line_item_id,
      item_label,
      verdict,
      determined_by,
      fiber,
      confidence,
      has_tag,
      tag_text,
      burn_result,
      photo_urls,
      warnings,
      recommended_method,
      checked_by_label,
      created_at,
      ops_appointments (
        appointment_date,
        ops_customers!ops_appointments_customer_id_fkey ( full_name, business_name )
      )
    `,
    )
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[admin/fiber-checks]', error)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }

  const { data: excluded } = await supabase
    .from('ops_appointment_line_items')
    .select(
      'id, appointment_id, name_snapshot, excluded_at, excluded_reason, excluded_original_total',
    )
    .not('excluded_at', 'is', null)
    .order('excluded_at', { ascending: false })
    .limit(200)

  const declinedValue = (excluded ?? []).reduce(
    (sum, row) => sum + Number(row.excluded_original_total || 0),
    0,
  )

  return NextResponse.json({
    checks: (checks ?? []).map((check) => {
      const appointment = Array.isArray(check.ops_appointments)
        ? check.ops_appointments[0]
        : check.ops_appointments
      const customer = appointment
        ? Array.isArray(appointment.ops_customers)
          ? appointment.ops_customers[0]
          : appointment.ops_customers
        : null
      return {
        ...check,
        ops_appointments: undefined,
        appointmentDate: appointment?.appointment_date ?? null,
        customerName:
          customer?.full_name || customer?.business_name || 'Customer',
      }
    }),
    excluded: excluded ?? [],
    declinedValue,
  })
}
