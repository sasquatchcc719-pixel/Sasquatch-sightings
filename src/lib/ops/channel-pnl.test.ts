import { describe, expect, it } from 'vitest'
import { summarizeCanvassLabor } from './channel-pnl'

describe('summarizeCanvassLabor', () => {
  const staff = [
    {
      user_id: 'david',
      display_name: 'David Gonzalez',
      hourly_rate: 23.5,
    },
    { user_id: 'charles', display_name: 'Charles', hourly_rate: null },
  ]
  const windows = [{ starts_on: '2026-07-01', ends_on: null }]

  it('keeps a running tally and rounds only after summing all sessions', () => {
    const summary = summarizeCanvassLabor(
      [
        {
          id: 'walk-1',
          user_id: 'david',
          started_at: '2026-07-27T20:35:25.895Z',
          ended_at: '2026-07-27T21:26:57.049Z',
          status: 'completed',
        },
        {
          id: 'walk-2',
          user_id: 'david',
          started_at: '2026-07-29T20:20:34.315Z',
          ended_at: '2026-07-29T20:31:22.879Z',
          status: 'completed',
        },
        // A duplicate source row must never double the cost.
        {
          id: 'walk-2',
          user_id: 'david',
          started_at: '2026-07-29T20:20:34.315Z',
          ended_at: '2026-07-29T20:31:22.879Z',
          status: 'completed',
        },
      ],
      staff,
      windows,
    )

    expect(summary).toEqual({
      cost: 24.41,
      hours: 1.04,
      sessions: 2,
      hourlyRate: 23.5,
      people: ['David Gonzalez'],
    })
  })

  it('excludes owner time, unfinished sessions, and sessions outside the campaign', () => {
    const summary = summarizeCanvassLabor(
      [
        {
          id: 'owner-walk',
          user_id: 'charles',
          started_at: '2026-07-27T20:00:00Z',
          ended_at: '2026-07-27T21:00:00Z',
          status: 'completed',
        },
        {
          id: 'unfinished',
          user_id: 'david',
          started_at: '2026-07-28T20:00:00Z',
          ended_at: null,
          status: 'active',
        },
        {
          id: 'too-early',
          user_id: 'david',
          started_at: '2026-06-30T20:00:00Z',
          ended_at: '2026-06-30T21:00:00Z',
          status: 'completed',
        },
      ],
      staff,
      windows,
    )

    expect(summary.cost).toBe(0)
    expect(summary.sessions).toBe(0)
  })
})
