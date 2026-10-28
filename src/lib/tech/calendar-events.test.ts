import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { getTechCalendarEvents } from './calendar-events'

const staffId = '01d0d46b-29ac-4a27-b953-f5fbc30cf2cd'
const authId = 'f7f07ef7-4f57-4cbb-b8b8-162404926c08'
const event = {
  id: 'door-hang',
  title: 'Door hang',
  description: 'Bring door hangers',
  start_date: '2026-10-28',
  end_date: '2026-10-28',
  start_time: '11:00:00',
  end_time: '13:00:00',
  is_all_day: false,
}

function client(rows: unknown[], ok = true) {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify(
        ok ? rows : { message: 'Calendar unavailable', code: 'XX000' },
      ),
      {
        status: ok ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  )
  const supabase = createClient('https://calendar.test', 'unit-test-key', {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return { supabase, fetch }
}

describe('technician calendar event loading', () => {
  it('queries the selected day and only the current staff/auth IDs or global events', async () => {
    const { supabase, fetch } = client([event])
    expect(
      await getTechCalendarEvents(supabase, staffId, authId, '2026-10-28'),
    ).toEqual([
      {
        id: 'door-hang',
        title: 'Door hang',
        description: 'Bring door hangers',
        startTime: '11:00:00',
        endTime: '13:00:00',
        isAllDay: false,
      },
    ])
    const url = new URL(String(fetch.mock.calls[0][0]))
    expect(url.pathname).toBe('/rest/v1/ops_calendar_events')
    expect(url.searchParams.get('start_date')).toBe('lte.2026-10-28')
    expect(url.searchParams.get('end_date')).toBe('gte.2026-10-28')
    expect(url.searchParams.get('or')).toBe(
      `(assigned_staff_user_id.eq.${staffId},assigned_staff_user_id.eq.${authId},assigned_staff_user_id.is.null)`,
    )
    expect(url.searchParams.get('select')).not.toContain('created_by')
  })

  it.each([
    ['2026-10-27', '20:00:00', '23:59:59', false],
    ['2026-10-28', '00:00:00', '23:59:59', true],
    ['2026-10-29', '00:00:00', '10:00:00', false],
  ])('clips a continuous event to %s', async (date, start, end, allDay) => {
    const { supabase } = client([
      {
        ...event,
        start_date: '2026-10-27',
        end_date: '2026-10-29',
        start_time: '20:00:00',
        end_time: '10:00:00',
      },
    ])
    expect(
      await getTechCalendarEvents(supabase, staffId, authId, date),
    ).toEqual([
      expect.objectContaining({
        startTime: start,
        endTime: end,
        isAllDay: allDay,
      }),
    ])
  })

  it('shows all-day events without times', async () => {
    const { supabase } = client([
      { ...event, is_all_day: true, start_time: null, end_time: null },
    ])
    expect(
      await getTechCalendarEvents(supabase, staffId, authId, '2026-10-28'),
    ).toEqual([expect.objectContaining({ isAllDay: true })])
  })

  it('surfaces load failures instead of silently reporting no events', async () => {
    const { supabase } = client([], false)
    await expect(
      getTechCalendarEvents(supabase, staffId, authId, '2026-10-28'),
    ).rejects.toMatchObject({ message: 'Calendar unavailable' })
  })
})
