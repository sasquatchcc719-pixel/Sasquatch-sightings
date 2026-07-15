import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loadBusinessHealth } from './business-health'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!url || !key)('loadBusinessHealth (real DB)', () => {
  it('returns retention, recurring, and booked-out from production data', async () => {
    const supabase = createClient(url!, key!)
    const h = await loadBusinessHealth(supabase)
    console.log(
      'retention:',
      JSON.stringify({
        ...h.retention,
        dueList: h.retention.dueList.slice(0, 3),
      }),
    )
    console.log('recurring:', JSON.stringify(h.recurring))
    console.log('bookedOut:', JSON.stringify(h.bookedOut))
    expect(h.retention.customers).toBeGreaterThan(0)
    expect(h.retention.totalRevenue).toBeGreaterThan(0)
    expect(h.bookedOut.length).toBeGreaterThan(0)
  }, 60000)
})
