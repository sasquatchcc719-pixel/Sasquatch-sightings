// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  appointmentStatus,
  estimateStatus,
  serializeAppointmentDetail,
} from './serializers'

describe('API v1 resource serialization', () => {
  it('normalizes internal appointment and estimate workflow states', () => {
    expect(appointmentStatus('booked')).toBe('scheduled')
    expect(appointmentStatus('on_my_way')).toBe('scheduled')
    expect(appointmentStatus('completed')).toBe('completed')
    expect(appointmentStatus('cancelled')).toBe('cancelled')
    expect(estimateStatus('draft')).toBe('pending')
    expect(estimateStatus('sent')).toBe('pending')
    expect(estimateStatus('converted')).toBe('accepted')
  })

  it('returns the invoice total when available and keeps Denver time semantics', () => {
    const serialized = serializeAppointmentDetail({
      id: 'appointment-id',
      appointment_date: '2026-10-05',
      start_time: '09:00:00',
      end_time: '11:00:00',
      status: 'confirmed',
      quoted_total: '240.00',
      invoices: [{ total: '255.00', payment_status: 'unpaid' }],
      services: [],
    })

    expect(serialized).toMatchObject({
      id: 'appointment-id',
      price: 255,
      status: 'scheduled',
      time_window: {
        date: '2026-10-05',
        start_time: '09:00:00',
        end_time: '11:00:00',
        timezone: 'America/Denver',
      },
    })
  })
})
