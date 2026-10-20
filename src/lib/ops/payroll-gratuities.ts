import type { createAdminClient } from '@/supabase/server'

// staff_users.id, rather than David's separate login/auth user id.
export const DAVID_PAYROLL_STAFF_ID = '01d0d46b-29ac-4a27-b953-f5fbc30cf2cd'

export type PayrollGratuityRow = {
  invoiceId: string
  invoiceNumber: number | string | null
  appointmentDate: string
  staffUserId: string
  staffName: string
  customerName: string
  paymentMethod: string | null
  amount: number
  status: 'payable' | 'pending'
}

export type PayrollGratuitySummary = {
  rows: PayrollGratuityRow[]
  payableGratuity: number
  pendingGratuity: number
}

type Related<T> = T | T[] | null
type Invoice = {
  id: string
  invoice_number: number | string | null
  status: string
  payment_status: string
  payment_method: string | null
  ops_appointments: Related<{
    appointment_date: string
    assigned_staff_user_id: string | null
    status: string
    kind: string | null
    ops_customers: Related<{
      full_name: string | null
      business_name: string | null
    }>
  }>
  ops_invoice_line_items: {
    id: string
    description: string
    line_total: number | string | null
    excluded_at: string | null
    service_catalog_items: Related<{ name: string; slug: string | null }>
  }[]
}

function first<T>(value: Related<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function normalized(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

export function summarizePayrollGratuities(
  invoices: Invoice[],
): PayrollGratuitySummary {
  const rows: PayrollGratuityRow[] = []
  const seenInvoices = new Set<string>()
  for (const invoice of invoices) {
    if (seenInvoices.has(invoice.id)) continue
    seenInvoices.add(invoice.id)
    const appointment = first(invoice.ops_appointments)
    if (
      !appointment ||
      appointment.assigned_staff_user_id !== DAVID_PAYROLL_STAFF_ID
    )
      continue
    if (
      appointment.kind === 'estimate' ||
      ['cancelled', 'canceled'].includes(appointment.status)
    )
      continue
    if (
      ['draft', 'void', 'cancelled', 'canceled', 'refunded'].includes(
        invoice.status,
      )
    )
      continue
    // Cash tips are handed directly to the technician, not paid again in payroll.
    if (normalized(invoice.payment_method) === 'cash') continue

    const seenLines = new Set<string>()
    let cents = 0
    for (const line of invoice.ops_invoice_line_items || []) {
      if (line.excluded_at || seenLines.has(line.id)) continue
      seenLines.add(line.id)
      const catalog = first(line.service_catalog_items)
      if (
        normalized(catalog?.slug) !== 'gratuity' &&
        ![catalog?.name, line.description].some((name) =>
          /^(gratuity|tip)$/.test(normalized(name)),
        )
      )
        continue
      const amount = Number(line.line_total)
      // Signed adjustments can reduce a recorded tip; never pay a negative total.
      if (Number.isFinite(amount)) cents += Math.round(amount * 100)
    }
    if (cents <= 0) continue
    const customer = first(appointment.ops_customers)
    rows.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      appointmentDate: appointment.appointment_date,
      staffUserId: DAVID_PAYROLL_STAFF_ID,
      staffName: 'David Gonzalez',
      customerName:
        customer?.business_name?.trim() ||
        customer?.full_name?.trim() ||
        'Customer',
      paymentMethod: invoice.payment_method,
      amount: cents / 100,
      status: invoice.payment_status === 'paid' ? 'payable' : 'pending',
    })
  }
  rows.sort(
    (a, b) =>
      b.appointmentDate.localeCompare(a.appointmentDate) ||
      a.customerName.localeCompare(b.customerName),
  )
  const total = (status: PayrollGratuityRow['status']) =>
    rows
      .filter((row) => row.status === status)
      .reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100
  return {
    rows,
    payableGratuity: total('payable'),
    pendingGratuity: total('pending'),
  }
}

export async function loadPayrollGratuities(
  db: ReturnType<typeof createAdminClient>,
  options: { startDate: string; endDate: string; staffUserId?: string },
): Promise<PayrollGratuitySummary> {
  if (options.staffUserId && options.staffUserId !== DAVID_PAYROLL_STAFF_ID) {
    return { rows: [], payableGratuity: 0, pendingGratuity: 0 }
  }
  const query = db
    .from('ops_invoices')
    .select(
      `
    id, invoice_number, status, payment_status, payment_method,
    ops_appointments!inner (
      appointment_date, assigned_staff_user_id, status, kind,
      ops_customers!ops_appointments_customer_id_fkey (full_name, business_name)
    ),
    ops_invoice_line_items (
      id, description, line_total, excluded_at,
      service_catalog_items (name, slug)
    )
  `,
    )
    .eq('ops_appointments.assigned_staff_user_id', DAVID_PAYROLL_STAFF_ID)
    .gte('ops_appointments.appointment_date', options.startDate)
    .lte('ops_appointments.appointment_date', options.endDate)
    .order('id', { ascending: true })
  const invoices: Invoice[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query.range(offset, offset + 499)
    if (error) throw error
    invoices.push(...((data || []) as unknown as Invoice[]))
    if (!data || data.length < 500) break
  }
  return summarizePayrollGratuities(invoices)
}
