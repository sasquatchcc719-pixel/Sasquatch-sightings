import { describe, expect, it } from 'vitest'
import {
  normalizeBookingErrorInput,
  summarizeBookingErrors,
  type BookingErrorRow,
} from './booking-errors'

function row(overrides: Partial<BookingErrorRow> = {}): BookingErrorRow {
  return {
    id: 'event-1',
    session_id: 's_example_123',
    stage: 'submit',
    error_message: 'Appointment could not be created',
    http_status: 500,
    quote_total: 275,
    item_count: 3,
    appointment_date: '2026-09-10',
    customer_name: 'Test Customer',
    customer_phone: '719-555-0100',
    customer_email: 'test@example.com',
    landing_path: '/',
    user_agent: 'Mozilla/5.0 (iPhone) AppleWebKit Safari/604.1',
    occurrence_count: 1,
    first_seen_at: '2026-09-04T12:00:00.000Z',
    last_seen_at: '2026-09-04T12:00:00.000Z',
    recovered_at: null,
    alert_sent_at: '2026-09-04T12:00:01.000Z',
    alert_error: null,
    ...overrides,
  }
}

describe('normalizeBookingErrorInput', () => {
  it.each([null, undefined, '', ' ', false])(
    'does not turn an unavailable HTTP status (%s) into a network status',
    (status) => {
      expect(
        normalizeBookingErrorInput(
          {
            session_id: 's_example_123',
            stage: 'services',
            error_message: 'Failed to load services',
            http_status: status,
          },
          null,
        )?.httpStatus,
      ).toBeNull()
    },
  )

  it.each([0, 503])('preserves the reported HTTP status %s', (status) => {
    expect(
      normalizeBookingErrorInput(
        {
          session_id: 's_example_123',
          stage: 'services',
          error_message: 'Failed to load services',
          http_status: status,
        },
        null,
      )?.httpStatus,
    ).toBe(status)
  })

  it('sanitizes a valid public error report', () => {
    expect(
      normalizeBookingErrorInput(
        {
          session_id: 's_example_123',
          stage: 'submit',
          error_message: '  Booking\nfailed  ',
          http_status: 503,
          quote_total: 275.559,
          item_count: 3.9,
          appointment_date: '2026-09-10',
          customer_name: ' Test Customer ',
        },
        'iPhone Safari',
      ),
    ).toMatchObject({
      sessionId: 's_example_123',
      stage: 'submit',
      errorMessage: 'Booking failed',
      httpStatus: 503,
      quoteTotal: 275.56,
      itemCount: 3,
      appointmentDate: '2026-09-10',
      customerName: 'Test Customer',
      userAgent: 'iPhone Safari',
    })
  })

  it('rejects unknown stages and malformed sessions', () => {
    expect(
      normalizeBookingErrorInput(
        {
          session_id: 'bad session',
          stage: 'submit',
          error_message: 'failed',
        },
        null,
      ),
    ).toBeNull()
    expect(
      normalizeBookingErrorInput(
        {
          session_id: 's_example_123',
          stage: 'not-real',
          error_message: 'failed',
        },
        null,
      ),
    ).toBeNull()
  })
})

describe('summarizeBookingErrors', () => {
  it('counts occurrences, sessions, recovery, and stages', () => {
    const result = summarizeBookingErrors(
      [
        row({ occurrence_count: 2 }),
        row({
          id: 'event-2',
          session_id: 's_other_456',
          stage: 'services',
          occurrence_count: 1,
          last_seen_at: '2026-09-03T10:00:00.000Z',
          recovered_at: '2026-09-03T10:10:00.000Z',
        }),
      ],
      new Date('2026-09-04T13:00:00.000Z'),
    )

    expect(result).toMatchObject({
      totalEvents: 3,
      affectedSessions: 2,
      unresolvedSessions: 1,
      last24Hours: 2,
      alertDeliveryFailures: 0,
    })
    expect(result.byStage).toEqual([
      {
        stage: 'services',
        label: 'Services would not load',
        events: 1,
        sessions: 1,
      },
      {
        stage: 'submit',
        label: 'Booking would not submit',
        events: 2,
        sessions: 1,
      },
    ])
    expect(result.recent[0]).toMatchObject({
      sessionId: 's_example_123',
      device: 'iPhone Safari',
      occurrenceCount: 2,
    })
  })
})
