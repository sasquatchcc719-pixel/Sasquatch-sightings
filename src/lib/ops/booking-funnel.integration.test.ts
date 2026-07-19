import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loadBookingFunnel } from './booking-funnel'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!url || !key)('loadBookingFunnel (real DB)', () => {
  it('aggregates funnel events from production data', async () => {
    const supabase = createClient(url!, key!)
    const f = await loadBookingFunnel(supabase, { windowDays: 90 })
    console.log(
      'funnel:',
      JSON.stringify({
        quoteSessions: f.quoteSessions,
        bookedSessions: f.bookedSessions,
        quoteToBookRate: f.quoteToBookRate,
        abandonedQuotes: f.abandonedQuotes,
        abandonedQuoteValue: f.abandonedQuoteValue,
        biggestDropStep: f.biggestDropStep,
        steps: f.steps.map((s) => `${s.step}:${s.sessions}`),
        referrers: f.topAbandonedReferrers,
      }),
    )
    expect(f.steps).toHaveLength(6)
    expect(f.quoteSessions).toBeGreaterThanOrEqual(0)
  }, 30000)
})
