import { describe, expect, it } from 'vitest'
import type { Appointment } from './operations-schedule-types'
import {
  appointmentHref,
  businessRowsToTemplates,
  computeOverlapColumns,
  getAppointmentPlacement,
  getOffHourSegmentsForGrid,
  getRangeForView,
  getScheduleCardSources,
  minutesToDbTime,
  templatesToBusinessRows,
} from './operations-schedule-utils'

function appointment(
  id: string,
  startTime: string,
  endTime: string,
): Appointment {
  return {
    id,
    appointment_date: '2026-09-30',
    start_time: startTime,
    end_time: endTime,
    status: 'booked',
    quoted_total: 0,
    lead_source: null,
    booking_channel: null,
    source: null,
    ops_customers: null,
    ops_service_addresses: null,
    ops_appointment_line_items: [],
    ops_invoices: null,
  }
}

describe('operations schedule pure helpers', () => {
  it('loads the surrounding week for day and week views', () => {
    const anchor = new Date('2026-09-30T12:00:00')
    expect(getRangeForView('day', anchor)).toEqual({
      startDate: '2026-09-27',
      endDate: '2026-10-03',
    })
    expect(getRangeForView('week', anchor)).toEqual({
      startDate: '2026-09-27',
      endDate: '2026-10-03',
    })
  })

  it('loads all six calendar rows for month view', () => {
    expect(getRangeForView('month', new Date('2026-09-15T12:00:00'))).toEqual({
      startDate: '2026-08-30',
      endDate: '2026-10-10',
    })
  })

  it('places overlapping appointments in separate columns and reuses a free column', () => {
    const columns = computeOverlapColumns([
      appointment('first', '09:00:00', '11:00:00'),
      appointment('overlap', '10:00:00', '12:00:00'),
      appointment('later', '12:00:00', '13:00:00'),
    ])

    expect(columns.get('first')).toEqual({ col: 0, totalCols: 2 })
    expect(columns.get('overlap')).toEqual({ col: 1, totalCols: 2 })
    expect(columns.get('later')).toEqual({ col: 0, totalCols: 1 })
  })

  it('uses the selected early-hours start when placing cards', () => {
    const early = getAppointmentPlacement(
      appointment('early', '07:30:00', '08:30:00'),
      null,
      7,
    )
    expect(early.top).toBe(42)
    expect(early.height).toBe(84)
    expect(early.startLabel).toBe('07:30')
  })

  it('round-trips business-hour rows with the schedule slot interval', () => {
    const rows = templatesToBusinessRows([
      {
        day_of_week: 1,
        start_time: '10:30:00',
        end_time: '18:30:00',
        slot_interval_minutes: 15,
        is_active: true,
      },
    ])

    expect(rows[1]).toEqual({
      day_of_week: 1,
      is_active: true,
      start_time: '10:30',
      end_time: '18:30',
    })
    expect(businessRowsToTemplates(rows)[0]).toEqual({
      day_of_week: 1,
      start_time: '10:30',
      end_time: '18:30',
      slot_interval_minutes: 30,
      is_active: true,
    })
  })

  it('marks only time outside business ranges for the chosen grid start', () => {
    expect(
      getOffHourSegmentsForGrid(
        [
          { start: 10 * 60, end: 12 * 60 },
          { start: 13 * 60, end: 17 * 60 },
        ],
        7,
      ),
    ).toEqual([
      { start: 7 * 60, end: 10 * 60 },
      { start: 12 * 60, end: 13 * 60 },
      { start: 17 * 60, end: 24 * 60 },
    ])
  })

  it('preserves source labels and clamps PATCH times', () => {
    const sourced = appointment('sourced', '09:00:00', '11:00:00')
    sourced.lead_source = 'lsa_sms'
    sourced.booking_channel = 'retell_rabecca'
    expect(getScheduleCardSources(sourced)).toEqual({
      leadLabel: 'Google LSA',
      bookingLabel: 'Rabecca',
    })
    expect(minutesToDbTime(-10)).toBe('00:00:00')
    expect(minutesToDbTime(24 * 60 + 20)).toBe('23:59:00')
  })

  it('keeps restoration visits linked to their project and selected visit', () => {
    const restoration = appointment('visit-1', '09:00:00', '10:00:00')
    restoration.kind = 'restoration'
    restoration.restoration_project_id = 'loss-1'
    expect(appointmentHref(restoration)).toBe(
      '/admin/operations/restoration/loss-1?visit=visit-1',
    )
  })
})
