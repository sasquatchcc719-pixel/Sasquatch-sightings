import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getStaffPrioritizedSlots, getUnionedSlots } from './staff-availability'

const date = '2026-11-30'

vi.mock('./staff', () => ({
  getOpenStaffForDate: async () => [
    { id: 'first', display_name: 'First technician', user_id: null },
    { id: 'second', display_name: 'Second technician', user_id: null },
  ],
}))

vi.mock('./availability-bundle', () => ({
  loadAvailabilityBundle: async (
    _: unknown,
    day: string,
    options: { staffUserId: string },
  ) => ({
    templates: [
      {
        day_of_week: 1,
        start_time: '09:00',
        end_time: '18:00',
        is_active: true,
      },
    ],
    overrides: [],
    appointments: [
      {
        appointment_date: day,
        start_time: options.staffUserId === 'first' ? '09:00' : '12:00',
        end_time: options.staffUserId === 'first' ? '12:00' : '18:00',
        status: 'booked',
      },
    ],
  }),
}))

describe('confirming public availability', () => {
  const params = {
    supabase: {} as SupabaseClient,
    date,
    requiredMinutes: 180,
    maxResults: 12,
  }

  it('assigns a displayed start to the technician who actually has it', async () => {
    expect(await getUnionedSlots(params)).toContainEqual({
      start_time: '09:00:00',
      end_time: '12:00:00',
    })

    expect(
      await getStaffPrioritizedSlots({
        ...params,
        requestedStartTime: '09:00:00',
      }),
    ).toMatchObject({ staffUserId: 'second' })
  })

  it('rejects the same start once the work needs four hours', async () => {
    expect(
      await getStaffPrioritizedSlots({
        ...params,
        requiredMinutes: 240,
        requestedStartTime: '09:00:00',
      }),
    ).toBeNull()
  })
})
