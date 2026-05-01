import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * GET /api/admin/ops/recurring/billing-summary?month=2026-04
 *
 * Returns one entry per customer (not per template), gathering all
 * batch_monthly visits for the month with dates, descriptions, and amounts.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()

    const url = new URL(request.url)
    const now = new Date()
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const month = url.searchParams.get('month') || defaultMonth

    const monthStart = `${month}-01`
    const [year, mon] = month.split('-').map(Number)
    const nextMonth =
      mon === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(mon + 1).padStart(2, '0')}-01`

    // 1. All active batch_monthly templates grouped by customer
    const { data: templates, error: tplErr } = await supabase
      .from('ops_recurring_templates')
      .select(
        `id, label, customer_id,
         ops_customers (id, full_name, business_name,
           ops_service_addresses (id, label, street_1, city, state, zip_code)
         )`,
      )
      .eq('invoice_mode', 'batch_monthly')
      .eq('is_active', true)

    if (tplErr) {
      return NextResponse.json({ error: tplErr.message }, { status: 500 })
    }

    if (!templates || templates.length === 0) {
      return NextResponse.json({ month, customers: [] })
    }

    const templateIds = templates.map((t) => t.id)

    const LINE_ITEM_SELECT = `id, name_snapshot, notes, quantity, unit_price, duration_minutes, line_total`

    // 2. All appointments for these templates in the month, with line items
    const { data: recurringAppts } = await supabase
      .from('ops_appointments')
      .select(
        `id, recurring_template_id, batch_billing_customer_id, status, quoted_total, appointment_date,
         ops_appointment_line_items (${LINE_ITEM_SELECT})`,
      )
      .in('recurring_template_id', templateIds)
      .gte('appointment_date', monthStart)
      .lt('appointment_date', nextMonth)
      .order('appointment_date')

    // 2b. One-off appointments tagged for batch billing for these customers
    const customerIds = [
      ...new Set(templates.map((t) => t.customer_id as string)),
    ]

    const { data: batchBillingAppts } = await supabase
      .from('ops_appointments')
      .select(
        `id, recurring_template_id, batch_billing_customer_id, status, quoted_total, appointment_date,
         ops_appointment_line_items (${LINE_ITEM_SELECT})`,
      )
      .in('batch_billing_customer_id', customerIds)
      .is('recurring_template_id', null)
      .gte('appointment_date', monthStart)
      .lt('appointment_date', nextMonth)
      .order('appointment_date')

    // Merge and deduplicate by appointment ID
    const seenIds = new Set<string>()
    const allAppts = [
      ...(recurringAppts || []),
      ...(batchBillingAppts || []),
    ].filter((a) => {
      if (seenIds.has(a.id)) return false
      seenIds.add(a.id)
      return true
    })
    const { data: batchInvoices } = await supabase
      .from('ops_batch_invoices')
      .select(
        'id, customer_id, status, sync_status, quickbooks_invoice_id, total',
      )
      .in('customer_id', customerIds)
      .gte('month', monthStart)
      .lt('month', nextMonth)

    // 4. Group templates by customer_id
    const templatesByCustomer = new Map<string, typeof templates>()
    for (const tpl of templates) {
      const cid = tpl.customer_id as string
      if (!templatesByCustomer.has(cid)) {
        templatesByCustomer.set(cid, [])
      }
      templatesByCustomer.get(cid)!.push(tpl)
    }

    // Build a templateId -> label map for descriptions
    const templateLabelMap = new Map<string, string>()
    for (const tpl of templates) {
      templateLabelMap.set(tpl.id, tpl.label)
    }

    const invoices = batchInvoices || []

    // 5. Build per-customer summary
    const customers = [...templatesByCustomer.entries()].map(
      ([customerId, tpls]) => {
        const tplIds = new Set(tpls.map((t) => t.id))

        // Unwrap customer from first template
        const rawCustomer = tpls[0].ops_customers
        const customer = Array.isArray(rawCustomer)
          ? (rawCustomer[0] ?? null)
          : (rawCustomer ?? null)

        // All appointments for this customer: recurring template matches + batch_billing one-offs
        const customerAppts = allAppts.filter(
          (a) =>
            (a.recurring_template_id && tplIds.has(a.recurring_template_id)) ||
            a.batch_billing_customer_id === customerId,
        )

        const visits = customerAppts.map((appt) => {
          const lines = Array.isArray(appt.ops_appointment_line_items)
            ? appt.ops_appointment_line_items
            : []

          // Build a human-readable description from line item notes/names
          const description = lines
            .map(
              (l: { notes?: string | null; name_snapshot: string }) =>
                l.notes || l.name_snapshot,
            )
            .join(', ')

          return {
            appointmentId: appt.id,
            date: appt.appointment_date,
            status: appt.status,
            total: appt.quoted_total || 0,
            templateLabel: appt.recurring_template_id
              ? templateLabelMap.get(appt.recurring_template_id) || ''
              : 'One-off',
            description,
            isAdHoc: !appt.recurring_template_id,
            lineItems: lines.map(
              (l: {
                id: string
                name_snapshot: string
                quantity: number
                unit_price: number
                duration_minutes: number
                line_total: number
                notes: string | null
              }) => ({
                id: l.id,
                name_snapshot: l.name_snapshot,
                quantity: l.quantity,
                unit_price: l.unit_price,
                duration_minutes: l.duration_minutes,
                line_total: l.line_total,
                notes: l.notes,
              }),
            ),
          }
        })

        const completedVisits = visits.filter((v) => v.status === 'completed')
        const runningTotal = completedVisits.reduce((s, v) => s + v.total, 0)

        const existingInvoice =
          invoices.find((bi) => bi.customer_id === customerId) || null

        // Extract addresses from the customer object
        const addresses = customer?.ops_service_addresses
          ? Array.isArray(customer.ops_service_addresses)
            ? customer.ops_service_addresses
            : [customer.ops_service_addresses]
          : []

        return {
          customerId,
          customerName: customer?.full_name || 'Unknown',
          businessName: customer?.business_name || null,
          addresses,
          visits,
          totalVisits: visits.length,
          completedVisits: completedVisits.length,
          runningTotal,
          existingInvoice,
        }
      },
    )

    // Sort by business name / customer name
    customers.sort((a, b) =>
      (a.businessName || a.customerName).localeCompare(
        b.businessName || b.customerName,
      ),
    )

    return NextResponse.json({ month, customers })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
