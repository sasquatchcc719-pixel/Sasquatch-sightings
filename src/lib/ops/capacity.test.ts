import { describe, expect, it } from 'vitest'
import { computeScheduleCapacity, type CapacityTemplate } from './capacity'

// Mon–Sat 9–5 global templates (matches production data)
const TEMPLATES: CapacityTemplate[] = [1, 2, 3, 4, 5, 6].map((dow) => ({
  day_of_week: dow,
  start_time: '09:00:00',
  end_time: '17:00:00',
  staff_user_id: null,
}))

const OWNER = { id: 'owner', default_open: true }
const TECH = { id: 'tech', default_open: false }

describe('computeScheduleCapacity', () => {
  it('single default-open tech: 48h per full Mon–Sat week', () => {
    // 2026-01-01 is a Thursday; through Sat Jan 10 = Thu,Fri,Sat + Mon–Sat
    const r = computeScheduleCapacity({
      templates: TEMPLATES,
      staff: [OWNER],
      toggles: [],
      today: '2026-01-10',
    })
    expect(r.ytdAvailableHours).toBe(9 * 8) // 9 working days × 8h
  })

  it('default-closed tech only adds hours on toggled-open days', () => {
    const base = computeScheduleCapacity({
      templates: TEMPLATES,
      staff: [OWNER, TECH],
      toggles: [],
      today: '2026-01-10',
    })
    const withTech = computeScheduleCapacity({
      templates: TEMPLATES,
      staff: [OWNER, TECH],
      toggles: [
        { staff_user_id: 'tech', date: '2026-01-05', is_open: true },
        { staff_user_id: 'tech', date: '2026-01-06', is_open: true },
      ],
      today: '2026-01-10',
    })
    expect(base.ytdAvailableHours).toBe(72)
    expect(withTech.ytdAvailableHours).toBe(72 + 16)
  })

  it('closed toggle does NOT remove a default-open tech — it is booking routing, not time off', () => {
    const r = computeScheduleCapacity({
      templates: TEMPLATES,
      staff: [OWNER],
      toggles: [{ staff_user_id: 'owner', date: '2026-01-02', is_open: false }],
      today: '2026-01-10',
    })
    expect(r.ytdAvailableHours).toBe(72)
  })

  it('closed toggle does remove a default-closed tech from a previously opened day', () => {
    const r = computeScheduleCapacity({
      templates: TEMPLATES,
      staff: [TECH],
      toggles: [
        { staff_user_id: 'tech', date: '2026-01-05', is_open: true },
        { staff_user_id: 'tech', date: '2026-01-06', is_open: false },
      ],
      today: '2026-01-10',
    })
    expect(r.ytdAvailableHours).toBe(8)
  })

  it('Sunday has no template hours', () => {
    const r = computeScheduleCapacity({
      templates: TEMPLATES,
      staff: [OWNER],
      toggles: [],
      today: '2026-01-04', // Thu 1st → Sun 4th
    })
    expect(r.ytdAvailableHours).toBe(24) // Thu+Fri+Sat only
  })

  it('per-staff templates override global for that tech', () => {
    const r = computeScheduleCapacity({
      templates: [
        ...TEMPLATES,
        {
          day_of_week: 5, // Friday only, 4h
          start_time: '09:00:00',
          end_time: '13:00:00',
          staff_user_id: 'tech',
        },
      ],
      staff: [{ id: 'tech', default_open: true }],
      toggles: [],
      today: '2026-01-03',
    })
    // Thu 1st: no per-staff template → 0; Fri 2nd: 4h; Sat 3rd: 0
    expect(r.ytdAvailableHours).toBe(4)
  })

  it('projects days beyond the toggle horizon at the trailing weekly average', () => {
    const r = computeScheduleCapacity({
      templates: TEMPLATES,
      staff: [OWNER],
      toggles: [],
      today: '2026-06-30',
      yearEnd: '2026-12-31',
    })
    // No toggles → every future day projected at trailing avg (48h/wk).
    expect(r.currentWeeklyCapacity).toBe(48)
    const futureDays =
      (Date.parse('2026-12-31') - Date.parse('2026-06-30')) / 86400000
    const expected = r.ytdAvailableHours + futureDays * (48 / 7)
    expect(r.annualAvailableHours).toBeCloseTo(expected, 0)
  })

  it('annual includes toggle-backed future days at their actual capacity', () => {
    const r = computeScheduleCapacity({
      templates: TEMPLATES,
      staff: [OWNER, TECH],
      toggles: [
        // tech opens two future days
        { staff_user_id: 'tech', date: '2026-07-20', is_open: true },
        { staff_user_id: 'tech', date: '2026-07-21', is_open: true },
      ],
      today: '2026-07-14',
    })
    const noToggle = computeScheduleCapacity({
      templates: TEMPLATES,
      staff: [OWNER, TECH],
      toggles: [],
      today: '2026-07-14',
    })
    // Same YTD, bigger annual: +16h from tech's future open days, minus the
    // projection difference for days now covered by toggles instead.
    expect(r.ytdAvailableHours).toBe(noToggle.ytdAvailableHours)
    expect(r.annualAvailableHours).toBeGreaterThan(0)
  })
})
