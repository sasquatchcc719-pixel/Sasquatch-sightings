import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loadScheduleCapacity } from './capacity'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!url || !key)('loadScheduleCapacity (real DB)', () => {
  it('returns schedule-based capacity from production data', async () => {
    const supabase = createClient(url!, key!)
    const r = await loadScheduleCapacity(supabase)
    console.log('capacity result:', JSON.stringify(r))
    expect(r).not.toBeNull()
    expect(r!.ytdAvailableHours).toBeGreaterThan(0)
    expect(r!.annualAvailableHours).toBeGreaterThan(r!.ytdAvailableHours)
    expect(r!.currentWeeklyCapacity).toBeGreaterThan(0)
  }, 30000)
})
