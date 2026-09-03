import { describe, expect, it } from 'vitest'
import {
  COMMERCIAL_KEY,
  resolveAttribution,
  summarizeAttribution,
  UNATTRIBUTED_KEY,
  type AttributionRow,
} from './attribution'

let seq = 0
const row = (over: Partial<AttributionRow>): AttributionRow => ({
  id: `a${++seq}`,
  customer_id: 'cust-1',
  appointment_date: '2026-06-01',
  status: 'completed',
  kind: 'service',
  lead_source: null,
  lead_source_key: null,
  revenue: 100,
  is_commercial: false,
  ...over,
})

const WINDOW = { startDate: '2026-01-01', endDate: '2026-12-31' }

describe('resolveAttribution', () => {
  it('keeps a directly recorded source', () => {
    const r = row({ lead_source_key: 'nextdoor' })
    const resolved = resolveAttribution([r])
    expect(resolved.get(r.id)).toEqual({
      key: 'nextdoor',
      inherited: false,
      isReturn: false,
    })
  })

  it('normalizes legacy free-text sources to canonical keys', () => {
    const r = row({ lead_source: 'Google', lead_source_key: null })
    const resolved = resolveAttribution([r])
    expect(resolved.get(r.id)?.key).toBe('google_search')
  })

  it('repeat-customer jobs inherit the customer first-touch source', () => {
    const first = row({
      appointment_date: '2026-02-01',
      lead_source_key: 'nextdoor',
    })
    const repeat = row({
      appointment_date: '2026-06-01',
      lead_source_key: 'repeat_customer',
    })
    const resolved = resolveAttribution([first, repeat])
    expect(resolved.get(repeat.id)).toEqual({
      key: 'nextdoor',
      inherited: true,
      isReturn: true,
    })
  })

  it('NULL-source recurring jobs inherit first-touch too', () => {
    const first = row({
      appointment_date: '2026-03-01',
      lead_source_key: 'facebook',
    })
    const recurring = row({ appointment_date: '2026-07-01' })
    const resolved = resolveAttribution([first, recurring])
    expect(resolved.get(recurring.id)).toEqual({
      key: 'facebook',
      inherited: true,
      isReturn: true,
    })
  })

  it('first-touch means EARLIEST, even when rows arrive out of order', () => {
    const later = row({
      appointment_date: '2026-05-01',
      lead_source_key: 'facebook',
    })
    const earliest = row({
      appointment_date: '2026-01-15',
      lead_source_key: 'google_search',
    })
    const repeat = row({
      appointment_date: '2026-07-01',
      lead_source_key: 'repeat_customer',
    })
    const resolved = resolveAttribution([later, earliest, repeat])
    expect(resolved.get(repeat.id)?.key).toBe('google_search')
  })

  it('repeat customer with no known origin stays in the repeat bucket', () => {
    const repeat = row({ lead_source_key: 'repeat_customer' })
    const resolved = resolveAttribution([repeat])
    expect(resolved.get(repeat.id)?.key).toBe('repeat_customer')
  })

  it('NULL source with no history is Unattributed, never dropped', () => {
    const orphan = row({ customer_id: 'cust-9' })
    const resolved = resolveAttribution([orphan])
    expect(resolved.get(orphan.id)?.key).toBe(UNATTRIBUTED_KEY)
  })

  it('business-name customers are Commercial even when tagged Other', () => {
    const r = row({
      lead_source_key: 'other',
      is_commercial: true,
      revenue: 900,
    })
    const resolved = resolveAttribution([r])
    expect(resolved.get(r.id)?.key).toBe(COMMERCIAL_KEY)
  })

  it('commercial customers never inherit a residential marketing channel', () => {
    const first = row({
      appointment_date: '2026-01-01',
      lead_source_key: 'nextdoor',
      is_commercial: true,
    })
    const later = row({
      appointment_date: '2026-06-01',
      lead_source_key: null,
      is_commercial: true,
    })
    const resolved = resolveAttribution([first, later])
    expect(resolved.get(first.id)?.key).toBe(COMMERCIAL_KEY)
    expect(resolved.get(later.id)?.key).toBe(COMMERCIAL_KEY)
  })
})

describe('summarizeAttribution', () => {
  it('credits lifetime revenue to the acquisition channel', () => {
    const rows = [
      row({
        appointment_date: '2026-02-01',
        lead_source_key: 'nextdoor',
        revenue: 300,
      }),
      row({
        appointment_date: '2026-05-01',
        lead_source_key: 'repeat_customer',
        revenue: 500,
      }),
      row({ appointment_date: '2026-07-01', revenue: 700 }), // recurring NULL
    ]
    const s = summarizeAttribution(rows, WINDOW)
    const nextdoor = s.sources.find((x) => x.lead_source_key === 'nextdoor')!
    expect(nextdoor.total_revenue).toBe(1500)
    expect(nextdoor.return_revenue).toBe(1200)
    expect(nextdoor.inherited_count).toBe(2)
    expect(s.attributed_revenue_pct).toBe(100)
  })

  it('keeps unattributed revenue visible and reports the attributed share', () => {
    const rows = [
      row({ customer_id: 'known', lead_source_key: 'facebook', revenue: 600 }),
      row({ customer_id: 'mystery', revenue: 400 }),
    ]
    const s = summarizeAttribution(rows, WINDOW)
    const unattributed = s.sources.find(
      (x) => x.lead_source_key === UNATTRIBUTED_KEY,
    )!
    expect(unattributed.total_revenue).toBe(400)
    expect(s.total_revenue).toBe(1000)
    expect(s.attributed_revenue_pct).toBe(60)
  })

  it('rolls commercial accounts into Commercial, not Other', () => {
    const rows = [
      row({
        customer_id: 'rv',
        lead_source_key: 'other',
        is_commercial: true,
        revenue: 1000,
      }),
      row({
        customer_id: 'home',
        lead_source_key: 'other',
        revenue: 200,
      }),
    ]
    const s = summarizeAttribution(rows, WINDOW)
    const commercial = s.sources.find(
      (x) => x.lead_source_key === COMMERCIAL_KEY,
    )!
    const other = s.sources.find((x) => x.lead_source_key === 'other')!
    expect(commercial.lead_source).toBe('Commercial')
    expect(commercial.total_revenue).toBe(1000)
    expect(other.total_revenue).toBe(200)
  })

  it('uses full history for inheritance but only the window for totals', () => {
    const rows = [
      // Acquisition happened last year — outside the window.
      row({
        appointment_date: '2025-08-01',
        lead_source_key: 'google_search',
        revenue: 250,
      }),
      // This year's repeat job — inside the window.
      row({
        appointment_date: '2026-04-01',
        lead_source_key: 'repeat_customer',
        revenue: 900,
      }),
    ]
    const s = summarizeAttribution(rows, {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    })
    const google = s.sources.find((x) => x.lead_source_key === 'google_search')!
    expect(google.total_revenue).toBe(900) // only the in-window job
    expect(google.booking_count).toBe(1)
  })

  it('excludes estimates and out-of-window rows', () => {
    const rows = [
      row({ lead_source_key: 'nextdoor', kind: 'estimate', revenue: 999 }),
      row({
        lead_source_key: 'nextdoor',
        appointment_date: '2025-01-01',
        revenue: 999,
      }),
      row({ lead_source_key: 'nextdoor', revenue: 100 }),
    ]
    const s = summarizeAttribution(rows, WINDOW)
    expect(s.total_revenue).toBe(100)
    expect(s.total_bookings).toBe(1)
  })

  it('only counts completed jobs toward revenue, all jobs toward bookings', () => {
    const rows = [
      row({ lead_source_key: 'nextdoor', revenue: 100 }),
      row({ lead_source_key: 'nextdoor', status: 'booked', revenue: 800 }),
    ]
    const s = summarizeAttribution(rows, WINDOW)
    const nextdoor = s.sources[0]
    expect(nextdoor.booking_count).toBe(2)
    expect(nextdoor.completed_count).toBe(1)
    expect(nextdoor.total_revenue).toBe(100)
  })
})
