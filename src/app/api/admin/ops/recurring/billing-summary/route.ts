import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * GET /api/admin/ops/recurring/billing-summary?month=2026-04
 *
 * Returns a summary of all batch_monthly recurring templates with:
 *  - Completed visits and running total for the requested month
 *  - Whether a batch invoice has already been generated for that month
 */
export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()

    const url = new URL(request.url)
    const now = new Date()
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const month = url.searchParams.get('month') || defaultMonth // e.g. "2026-04"

    const monthStart = `${month}-01`
    const [year, mon] = month.split('-').map(Number)
    const nextMonth =
      mon === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(mon + 1).padStart(2, '0')}-01`

    // 1. All active batch_monthly templates with customer info
    const { data: templates, error: tplErr } = await supabase
      .from('ops_recurring_templates')
      .select(`id, label, ops_customers (id, full_name, business_name)`)
      .eq('invoice_mode', 'batch_monthly')
      .eq('is_active', true)
      .order('label')

    if (tplErr) {
      return NextResponse.json({ error: tplErr.message }, { status: 500 })
    }

    if (!templates || templates.length === 0) {
      return NextResponse.json({ month, entries: [] })
    }

    const templateIds = templates.map((t) => t.id)

    // 2. All appointments for these templates in the requested month
    const { data: appointments } = await supabase
      .from('ops_appointments')
      .select(
        'id, recurring_template_id, status, quoted_total, appointment_date',
      )
      .in('recurring_template_id', templateIds)
      .gte('appointment_date', monthStart)
      .lt('appointment_date', nextMonth)

    // 3. Existing batch invoices for these templates for this month
    const { data: batchInvoices } = await supabase
      .from('ops_batch_invoices')
      .select('id, recurring_template_id, status, total')
      .in('recurring_template_id', templateIds)
      .gte('month', monthStart)
      .lt('month', nextMonth)

    // 4. Build per-template summary
    const appts = appointments || []
    const invoices = batchInvoices || []

    const entries = templates.map((tpl) => {
      const tplAppts = appts.filter((a) => a.recurring_template_id === tpl.id)
      const completedAppts = tplAppts.filter((a) => a.status === 'completed')
      const runningTotal = completedAppts.reduce(
        (s, a) => s + (a.quoted_total || 0),
        0,
      )
      const existingInvoice =
        invoices.find((bi) => bi.recurring_template_id === tpl.id) || null

      // Unwrap customer (Supabase may return array or object)
      const customer = Array.isArray(tpl.ops_customers)
        ? (tpl.ops_customers[0] ?? null)
        : (tpl.ops_customers ?? null)

      return {
        templateId: tpl.id,
        label: tpl.label,
        customer,
        totalVisits: tplAppts.length,
        completedVisits: completedAppts.length,
        runningTotal,
        existingInvoice,
      }
    })

    return NextResponse.json({ month, entries })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
