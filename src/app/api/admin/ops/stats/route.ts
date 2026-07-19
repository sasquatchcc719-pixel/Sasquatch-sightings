import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { effectiveInvoiceAmount } from '@/lib/ops/utilization-metrics'
import { loadAttributionRows, resolveAttribution } from '@/lib/ops/attribution'
import { CANONICAL_LEAD_SOURCE_OPTIONS } from '@/lib/lead-sources'

function getWeekBounds(): { weekStart: string; weekEnd: string } {
  const now = new Date()
  const day = now.getDay() // 0 = Sunday
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((day + 6) % 7))
  monday.setHours(0, 0, 0, 0)

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)

  const fmt = (d: Date) => d.toISOString().split('T')[0]
  return { weekStart: fmt(monday), weekEnd: fmt(sunday) }
}

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { weekStart, weekEnd } = getWeekBounds()

    // Fetch this week's appointments with their invoices and lead source
    const { data: appointments, error } = await supabase
      .from('ops_appointments')
      .select(
        `
        id,
        appointment_date,
        status,
        lead_source,
        quoted_total,
        ops_invoices (
          total,
          payment_status,
          ops_invoice_line_items ( line_total )
        )
      `,
      )
      .gte('appointment_date', weekStart)
      .lte('appointment_date', weekEnd)
      .not('status', 'eq', 'cancelled')

    if (error) throw error

    const rows = appointments ?? []

    // Revenue: sum invoice totals (only jobs that have an invoice)
    let totalRevenue = 0
    let invoicedJobCount = 0
    const paymentStatusCounts: Record<string, number> = {}

    for (const appt of rows) {
      const invoices = Array.isArray(appt.ops_invoices)
        ? appt.ops_invoices
        : appt.ops_invoices
          ? [appt.ops_invoices]
          : []
      for (const inv of invoices) {
        const lineItems = Array.isArray(
          (inv as { ops_invoice_line_items?: unknown }).ops_invoice_line_items,
        )
          ? (inv as { ops_invoice_line_items: { line_total?: number }[] })
              .ops_invoice_line_items
          : []
        totalRevenue += effectiveInvoiceAmount({
          invoiceTotal: Number((inv as { total?: number }).total || 0),
          invoiceLineItems: lineItems,
          quotedTotal: Number(
            (appt as { quoted_total?: number }).quoted_total || 0,
          ),
        })
        invoicedJobCount++
        const ps = String(inv.payment_status || 'unpaid')
        paymentStatusCounts[ps] = (paymentStatusCounts[ps] ?? 0) + 1
      }
    }

    // Job count by status
    const statusCounts: Record<string, number> = {}
    for (const appt of rows) {
      const s = String(appt.status || 'unknown')
      statusCounts[s] = (statusCounts[s] ?? 0) + 1
    }

    // Lead source breakdown — same attribution engine as the revenue page,
    // so the weekly card and the YTD revenue card can never disagree on
    // grouping. First-touch: repeat/recurring jobs count under the channel
    // that originally won the customer.
    const leadSourceCounts: Record<string, number> = {}
    try {
      const attributionRows = await loadAttributionRows(supabase)
      const resolved = resolveAttribution(attributionRows)
      const weekIds = new Set(rows.map((r) => String(r.id)))
      for (const row of attributionRows) {
        if (!weekIds.has(row.id)) continue
        const key = resolved.get(row.id)?.key ?? 'unattributed'
        const label =
          key === 'unattributed'
            ? 'Unattributed'
            : (CANONICAL_LEAD_SOURCE_OPTIONS.find((o) => o.source_key === key)
                ?.customer_label ?? key)
        leadSourceCounts[label] = (leadSourceCounts[label] ?? 0) + 1
      }
    } catch {
      // Fallback: raw field, so the card still renders if attribution fails.
      for (const appt of rows) {
        const src = appt.lead_source ? String(appt.lead_source) : 'Unknown'
        leadSourceCounts[src] = (leadSourceCounts[src] ?? 0) + 1
      }
    }

    // Average ticket
    const averageTicket =
      invoicedJobCount > 0 ? totalRevenue / invoicedJobCount : 0

    return NextResponse.json({
      weekStart,
      weekEnd,
      jobCount: rows.length,
      invoicedJobCount,
      totalRevenue,
      averageTicket,
      statusCounts,
      paymentStatusCounts,
      leadSourceCounts,
    })
  } catch (error) {
    console.error('[ops/stats][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load ops stats' },
      { status: 500 },
    )
  }
}
