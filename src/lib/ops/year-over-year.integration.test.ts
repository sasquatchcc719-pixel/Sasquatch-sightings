import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loadYearOverYear } from './year-over-year'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!url || !key)('loadYearOverYear (real DB)', () => {
  it('summarizes real QuickBooks history', async () => {
    const sb = createClient(url!, key!)
    const h = await loadYearOverYear(sb, { today: '2026-07-19' })
    console.log(
      'HEADLINE:',
      JSON.stringify({
        ytd: h!.ytd,
        priorYtd: h!.priorYtd,
        growth: h!.ytdGrowthPct,
        priorFullYear: h!.priorFullYear,
        pctOfPriorFullYear: h!.pctOfPriorFullYear,
      }),
    )
    console.log(
      'YEARS:',
      JSON.stringify(
        h!.years.map(
          (y) =>
            `${y.year}: full=${y.fullYear} ytd=${y.throughToday} n=${y.invoices} avg=${y.avgTicket} growth=${y.ytdGrowthPct}`,
        ),
      ),
    )
    expect(h).not.toBeNull()
    expect(h!.years.length).toBeGreaterThan(1)
    // 2021 had only 9 invoices — must be excluded as too sparse
    expect(h!.years.some((y) => y.year === 2021)).toBe(false)
  }, 30000)
})
