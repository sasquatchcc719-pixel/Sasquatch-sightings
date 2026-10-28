import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TechDaySchedule } from './tech-day-schedule'
import type { TechCalendarEvent } from '@/lib/tech/calendar-events'
import type { TechAppointment } from '@/lib/tech/appointments'

const event: TechCalendarEvent = {
  id: 'door-hang',
  title: 'Door hang',
  description: 'Bring door hangers',
  startTime: '11:00:00',
  endTime: '13:00:00',
  isAllDay: false,
}
const appointment: TechAppointment = {
  assignedStaffUserId: 'staff-david',
  appointmentDate: '2026-10-28',
  paymentStatus: null,
  recurringTemplateId: null,
  restorationProjectId: null,
  visitType: null,
  customerPhone: null,
  customerEmail: null,
  internalNotes: null,
  hidePricing: false,
  photos: [],
  fiberChecks: [],
  id: 'job',
  customerName: 'Test Customer',
  businessName: null,
  startTime: '12:00:00',
  endTime: '14:00:00',
  status: 'booked',
  lineItems: [],
  invoice: null,
  address: null,
  quotedTotal: 200,
}

afterEach(cleanup)

describe('technician schedule events', () => {
  it('shows an event with its times and notes on a day without jobs', () => {
    render(<TechDaySchedule appointments={[]} events={[event]} />)
    const card = screen.getByRole('article', { name: 'Door hang' })
    expect(card).toHaveTextContent('11:00 AM - 1:00 PM')
    expect(card).toHaveTextContent('Bring door hangers')
    expect(card).toHaveStyle({ top: '341px', height: '158px' })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows all-day blocks above the grid', () => {
    render(
      <TechDaySchedule
        appointments={[]}
        events={[{ ...event, isAllDay: true }]}
      />,
    )
    expect(screen.getByRole('article')).toHaveTextContent('All day')
    expect(screen.getByRole('article').style.top).toBe('')
  })

  it('keeps sleep blocks ending before the grid visible with their actual times', () => {
    render(
      <TechDaySchedule
        appointments={[]}
        events={[
          {
            ...event,
            title: 'Sleep',
            startTime: '00:00:00',
            endTime: '06:00:00',
          },
        ]}
      />,
    )
    expect(screen.getByRole('article', { name: 'Sleep' })).toHaveTextContent(
      '12:00 AM - 6:00 AM',
    )
    expect(screen.getByRole('article').style.top).toBe('')
  })

  it('keeps an overlapping job and event side by side and retains the job link', () => {
    render(<TechDaySchedule appointments={[appointment]} events={[event]} />)
    expect(screen.getByRole('article')).toHaveStyle({ right: '50%' })
    const job = screen.getByRole('link', { name: /Test Customer/ })
    expect(job).toHaveStyle({ left: '50%' })
    expect(job).toHaveAttribute('href', '/tech/jobs/job')
  })
})
