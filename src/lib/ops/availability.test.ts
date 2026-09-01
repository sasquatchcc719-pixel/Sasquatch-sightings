import { describe, expect, it } from 'vitest'
import {
  addMinutesToTimeWithinDay,
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
  calendarEventsToAppointmentWindows,
  DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
  getAvailableSlots,
  resolveSelectedStartTime,
} from './availability'

describe('availability gap fill', () => {
  it('keeps three-hour jobs at three hours', () => {
    expect(applyAppointmentBuffer(180)).toBe(180)
  })

  it('offers the earliest three-hour gap between existing jobs', () => {
    const slots = getAvailableSlots({
      date: '2026-05-04',
      requiredMinutes: applyAppointmentBuffer(180),
      templates: DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
      overrides: [],
      appointments: [
        {
          appointment_date: '2026-05-04',
          start_time: '09:00:00',
          end_time: '11:00:00',
          status: 'booked',
        },
        {
          appointment_date: '2026-05-04',
          start_time: '11:00:00',
          end_time: '14:00:00',
          status: 'booked',
        },
        {
          appointment_date: '2026-05-04',
          start_time: '18:00:00',
          end_time: '22:00:00',
          status: 'booked',
        },
      ],
      maxResults: 1,
    })

    expect(slots).toEqual([
      {
        start_time: '14:00:00',
        end_time: '17:00:00',
      },
    ])
  })

  it('does not offer a 2-hour gap to a dollar-sized 4-hour job (double-book guard)', () => {
    // A $601+ job stores a 4-hour block on the server (dollar tiers). The admin
    // picker must size availability by that same block, or it will offer the
    // 09:00 gap in front of an 11:00 appointment and double-book the tech.
    const requiredMinutes = applyAppointmentBuffer(
      calculateAppointmentDurationFromTotal(650),
    )
    expect(requiredMinutes).toBe(240)

    const slots = getAvailableSlots({
      date: '2026-05-04',
      requiredMinutes,
      templates: DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
      overrides: [],
      appointments: [
        {
          appointment_date: '2026-05-04',
          start_time: '11:00:00',
          end_time: '13:00:00',
          status: 'booked',
        },
      ],
      maxResults: 8,
    })

    // The only opening long enough for 4 hours starts at 13:00 (13:00–17:00).
    // 09:00 must NOT appear — it would run to 13:00 and collide with the 11:00.
    expect(slots.every((slot) => slot.start_time !== '09:00:00')).toBe(true)
    expect(slots).toEqual([
      {
        start_time: '13:00:00',
        end_time: '17:00:00',
      },
    ])
  })

  it('blocks an entire day for all-day calendar events', () => {
    const date = '2026-05-16'
    const blockedWindows = calendarEventsToAppointmentWindows(date, [
      {
        start_date: '2026-05-14',
        end_date: '2026-05-16',
        start_time: null,
        end_time: null,
        is_all_day: true,
        event_kind: 'block',
      },
    ])

    const slots = getAvailableSlots({
      date,
      requiredMinutes: applyAppointmentBuffer(120),
      templates: DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
      overrides: [],
      appointments: blockedWindows,
    })

    expect(slots).toEqual([])
  })

  it('blocks only overlapping slots for timed calendar events', () => {
    const date = '2026-05-07'
    const blockedWindows = calendarEventsToAppointmentWindows(date, [
      {
        start_date: date,
        end_date: date,
        start_time: '09:00:00',
        end_time: '11:00:00',
        is_all_day: false,
        event_kind: 'block',
      },
    ])

    const slots = getAvailableSlots({
      date,
      requiredMinutes: applyAppointmentBuffer(120),
      templates: DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
      overrides: [],
      appointments: blockedWindows,
    })

    expect(slots[0]).toEqual({
      start_time: '11:00:00',
      end_time: '13:00:00',
    })
  })
})

describe('after-hours admin bookings', () => {
  const slots = [
    { start_time: '09:00:00', end_time: '11:00:00' },
    { start_time: '13:00:00', end_time: '15:00:00' },
  ]

  it('keeps a hand-typed after-hours time when the openings reload', () => {
    // Typing 6:00 PM then assigning a tech reloads the slot list; the evening
    // start is never one of the openings, and used to be replaced by 09:00.
    expect(
      resolveSelectedStartTime({
        slots,
        currentStartTime: '18:00',
        useCustomTime: true,
      }),
    ).toBe('18:00')
  })

  it('still snaps a stale grid pick to the first real opening', () => {
    expect(
      resolveSelectedStartTime({
        slots,
        currentStartTime: '11:00',
        useCustomTime: false,
      }),
    ).toBe('09:00')
  })

  it('leaves a start time that is still one of the openings alone', () => {
    expect(
      resolveSelectedStartTime({
        slots,
        currentStartTime: '13:00',
        useCustomTime: false,
      }),
    ).toBe('13:00')
  })

  it('keeps the picked time when the day has no openings at all', () => {
    expect(
      resolveSelectedStartTime({
        slots: [],
        currentStartTime: '19:30',
        useCustomTime: false,
      }),
    ).toBe('19:30')
  })

  it('ends an evening job at the end of its own day, never past midnight', () => {
    expect(addMinutesToTimeWithinDay('18:00', 120)).toBe('20:00:00')
    expect(addMinutesToTimeWithinDay('22:30', 240)).toBe('23:59:00')
    expect(addMinutesToTimeWithinDay('19:00:00', 180)).toBe('22:00:00')
  })
})

describe('appointment sizing excludes fees', () => {
  // The booking widget sizes the job from the service subtotal to ask
  // /api/public/availability for openings. If the server sizes the same job
  // differently it can compute a longer window than the one the customer was
  // offered, and reject the time they picked as "no longer available".
  const TRAVEL_CHARGE = 40

  it('keeps a travel-charge job in the same tier as the widget', () => {
    const serviceSubtotal = 270 // widget asks for a 2-hour window
    const invoiceSubtotal = serviceSubtotal + TRAVEL_CHARGE

    expect(calculateAppointmentDurationFromTotal(serviceSubtotal)).toBe(120)
    // Sizing on the invoice subtotal silently upgrades it to 3 hours.
    expect(calculateAppointmentDurationFromTotal(invoiceSubtotal)).toBe(180)
    // The server must back the fee out before applying the tiers.
    expect(
      calculateAppointmentDurationFromTotal(invoiceSubtotal - TRAVEL_CHARGE),
    ).toBe(120)
  })

  it('agrees with the widget across both tier boundaries', () => {
    for (const serviceSubtotal of [180, 261, 300, 301, 560, 600, 601, 900]) {
      const invoiceSubtotal = serviceSubtotal + TRAVEL_CHARGE
      expect(
        calculateAppointmentDurationFromTotal(invoiceSubtotal - TRAVEL_CHARGE),
      ).toBe(calculateAppointmentDurationFromTotal(serviceSubtotal))
    }
  })
})
