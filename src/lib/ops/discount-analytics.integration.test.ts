import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { loadDiscountAnalytics } from './discount-analytics'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!url || !key)('loadDiscountAnalytics (real DB)', () => {
  it('summarizes current invoice discounts', async () => {
    const supabase = createClient(url!, key!)
    const result = await loadDiscountAnalytics(supabase, { year: 2026 })

    console.log(
      'discounts:',
      JSON.stringify({
        invoices: result.discountedInvoices,
        completed: result.completedInvoices,
        total: result.totalDiscount,
        completedAmount: result.completedDiscount,
        scheduledAmount: result.scheduledDiscount,
        lifetimeCodeUses: result.lifetimeCodeUses,
        breakdown: result.breakdown,
      }),
    )

    expect(result.year).toBe(2026)
    expect(result.discountedInvoices).toBeGreaterThan(0)
    expect(result.totalDiscount).toBeGreaterThan(0)
    expect(result.months).toHaveLength(12)
    expect(result.completedDiscount + result.scheduledDiscount).toBeCloseTo(
      result.totalDiscount,
      2,
    )
  }, 30000)
})
