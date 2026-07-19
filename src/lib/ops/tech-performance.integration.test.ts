import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loadTechPerformance } from './tech-performance'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!url || !key)('loadTechPerformance (real DB)', () => {
  it('returns per-tech monthly profitability from production data', async () => {
    const supabase = createClient(url!, key!)
    const techs = await loadTechPerformance(supabase)
    console.log('tech performance:', JSON.stringify(techs, null, 1))
    expect(techs.length).toBeGreaterThan(0)
    const david = techs[0]
    expect(david.days.length).toBeGreaterThan(0)
    expect(david.months.length).toBeGreaterThan(0)
    expect(david.totals.revenue).toBeGreaterThan(0)
    expect(david.totals.grossWages).toBeGreaterThan(0)
  }, 30000)
})
