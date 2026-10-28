import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TechHomePage from './page'
import { getTechCalendarEvents } from '@/lib/tech/calendar-events'

vi.mock('@/lib/auth', () => ({
  requireAnyRole: vi.fn().mockResolvedValue({
    id: 'auth-david',
    role: 'tech',
    staff: { id: 'staff-david' },
  }),
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
  }),
}))
vi.mock('@/lib/tech/appointments', () => ({
  getAssignedTechAppointments: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/tech/calendar-events', () => ({
  getTechCalendarEvents: vi.fn(),
}))
vi.mock('@/lib/ops/add-on-bonuses', () => ({
  loadAddOnBonuses: vi.fn(),
  usesInvoiceGrowthBonus: () => false,
}))
vi.mock('@/components/truck-weather-card', () => ({
  TruckWeatherCard: () => null,
}))

afterEach(cleanup)
beforeEach(() => vi.mocked(getTechCalendarEvents).mockResolvedValue([]))

describe('Tech Portal day', () => {
  it('loads David’s events for the selected day and displays them even without jobs', async () => {
    vi.mocked(getTechCalendarEvents).mockResolvedValue([
      {
        id: 'door-hang',
        title: 'Door hang',
        description: null,
        startTime: '11:00:00',
        endTime: '13:00:00',
        isAllDay: false,
      },
    ])
    render(
      await TechHomePage({
        searchParams: Promise.resolve({ date: '2026-10-28' }),
      }),
    )
    expect(getTechCalendarEvents).toHaveBeenCalledWith(
      expect.anything(),
      'staff-david',
      'auth-david',
      '2026-10-28',
    )
    expect(screen.getByRole('article', { name: 'Door hang' })).toBeVisible()
    expect(
      screen.queryByText('No jobs or events scheduled'),
    ).not.toBeInTheDocument()
  })

  it('shows the empty state only when both jobs and events are empty', async () => {
    render(
      await TechHomePage({
        searchParams: Promise.resolve({ date: '2026-10-28' }),
      }),
    )
    expect(screen.getByText('No jobs or events scheduled')).toBeVisible()
  })
})
