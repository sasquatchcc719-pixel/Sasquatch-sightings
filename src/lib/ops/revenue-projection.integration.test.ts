import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loadSeasonality } from './revenue-projection'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!url || !key)('loadSeasonality (real DB)', () => {
  it('learns monthly seasonality from QuickBooks history', async () => {
    const supabase = createClient(url!, key!)
    const { seasonality, years } = await loadSeasonality(supabase, {
      currentYear: 2026,
    })
    console.log('seasonality years:', JSON.stringify(years))
    console.log(
      'monthly share %:',
      JSON.stringify(seasonality?.map((s) => Math.round(s * 1000) / 10)),
    )
    expect(seasonality).not.toBeNull()
    expect(seasonality).toHaveLength(12)
    const sum = seasonality!.reduce((s, v) => s + v, 0)
    expect(sum).toBeCloseTo(1, 2)
    // Sparse startup years must be excluded
    expect(years).not.toContain(2021)
  }, 30000)
})
