import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loadAttributedLeadSources } from './attribution'
import { loadPartnerLiveStats } from './partner-stats'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!url || !key)('attribution engine (real DB)', () => {
  it('attributes YTD revenue with first-touch inheritance', async () => {
    const sb = createClient(url!, key!)
    const s = await loadAttributedLeadSources(sb, {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    })
    console.log('ATTRIBUTED %:', s.attributed_revenue_pct)
    console.log('TOTAL:', s.total_revenue, 'BOOKINGS:', s.total_bookings)
    for (const src of s.sources) {
      console.log(
        `  ${src.lead_source}: $${Math.round(src.total_revenue)} (${src.booking_count} jobs, $${Math.round(src.return_revenue)} repeat/recurring, ${src.inherited_count} inherited)`,
      )
    }
    expect(s.total_revenue).toBeGreaterThan(50000)
    expect(s.attributed_revenue_pct).toBeGreaterThan(56)
  }, 30000)

  it('partner live stats count real taps and bookings', async () => {
    const sb = createClient(url!, key!)
    const stats = await loadPartnerLiveStats(sb)
    let taps = 0,
      bookings = 0,
      revenue = 0
    for (const s of stats.values()) {
      taps += s.taps
      bookings += s.bookings
      revenue += s.revenue
    }
    console.log('PARTNER TOTALS:', {
      taps,
      bookings,
      revenue: Math.round(revenue),
    })
    expect(taps).toBeGreaterThan(50)
    expect(bookings).toBeGreaterThan(0)
  }, 30000)
})
