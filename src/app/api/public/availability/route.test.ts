// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getUnionedSlots } from '@/lib/ops/staff-availability'
import { GET } from './route'

vi.mock('@/supabase/server', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/ops/staff-availability', () => ({
  getUnionedSlots: vi.fn().mockResolvedValue([]),
}))

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('uses the same Mountain Time lead time in the month calendar and daily slots', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-27T17:00:00Z'))

  const params = 'required_minutes=180'
  const range = await GET(
    new NextRequest(
      `https://example.test/availability?start_date=2026-11-27&end_date=2026-11-28&${params}`,
    ),
  )
  const day = await GET(
    new NextRequest(
      `https://example.test/availability?date=2026-11-27&${params}`,
    ),
  )

  expect(range.status).toBe(200)
  expect(day.status).toBe(200)
  expect(
    vi
      .mocked(getUnionedSlots)
      .mock.calls.map(([query]) => [
        query.date,
        query.minStartMinutes,
        query.requiredMinutes,
      ]),
  ).toEqual([
    ['2026-11-27', 660, 180],
    ['2026-11-28', undefined, 180],
    ['2026-11-27', 660, 180],
  ])
})
