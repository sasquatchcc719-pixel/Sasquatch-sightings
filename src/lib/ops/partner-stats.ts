import type { SupabaseClient } from '@supabase/supabase-js'
import { effectiveInvoiceAmount } from '@/lib/ops/utilization-metrics'

/**
 * Live per-partner stats derived from raw tables — no denormalized counters.
 *
 * The old model kept hand-incremented partners.total_taps /
 * total_conversions, which drifted from reality (counters said 62 taps and 0
 * bookings while the raw log held 407 taps and the booking table held real
 * NFC jobs). Everything here is counted at read time:
 *   taps        → nfc_card_taps rows for the partner
 *   engagement  → taps with a conversion_type (booking click, text, call…)
 *   bookings    → ops_appointments with partner_id set (stamped at booking
 *                 via the landing page or the partner's coupon code)
 *   revenue     → those bookings' invoice/quoted totals
 */

export type PartnerLiveStats = {
  partnerId: string
  taps: number
  engagedTaps: number
  bookings: number
  completedBookings: number
  revenue: number
  lastTapAt: string | null
}

export async function loadPartnerLiveStats(
  supabase: SupabaseClient,
): Promise<Map<string, PartnerLiveStats>> {
  const [tapsRes, apptsRes] = await Promise.all([
    supabase
      .from('nfc_card_taps')
      .select('partner_id, conversion_type, tapped_at')
      .not('partner_id', 'is', null)
      .limit(50000),
    supabase
      .from('ops_appointments')
      .select(
        `
        partner_id, status, kind, quoted_total,
        ops_invoices ( total, ops_invoice_line_items ( line_total ) )
      `,
      )
      .not('partner_id', 'is', null)
      .neq('status', 'cancelled')
      .limit(20000),
  ])

  const stats = new Map<string, PartnerLiveStats>()
  const entry = (partnerId: string): PartnerLiveStats => {
    let s = stats.get(partnerId)
    if (!s) {
      s = {
        partnerId,
        taps: 0,
        engagedTaps: 0,
        bookings: 0,
        completedBookings: 0,
        revenue: 0,
        lastTapAt: null,
      }
      stats.set(partnerId, s)
    }
    return s
  }

  for (const tap of tapsRes.data || []) {
    const s = entry(String(tap.partner_id))
    s.taps++
    if (tap.conversion_type) s.engagedTaps++
    const at = tap.tapped_at ? String(tap.tapped_at) : null
    if (at && (!s.lastTapAt || at > s.lastTapAt)) s.lastTapAt = at
  }

  for (const appt of apptsRes.data || []) {
    const s = entry(String(appt.partner_id))
    s.bookings++
    if (appt.status === 'completed') {
      s.completedBookings++
      const inv = Array.isArray(appt.ops_invoices)
        ? appt.ops_invoices[0]
        : appt.ops_invoices
      const lineItems = Array.isArray(inv?.ops_invoice_line_items)
        ? inv.ops_invoice_line_items
        : inv?.ops_invoice_line_items
          ? [inv.ops_invoice_line_items]
          : []
      s.revenue += effectiveInvoiceAmount({
        invoiceTotal: Number(inv?.total || 0),
        invoiceLineItems: lineItems,
        quotedTotal: Number(appt.quoted_total || 0),
        kind: appt.kind ? String(appt.kind) : null,
      })
    }
  }

  return stats
}
