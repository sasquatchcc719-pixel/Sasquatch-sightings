import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppointmentDetail } from './appointment-detail'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/lib/ops/arrival', () => ({
  geocodeAddress: vi.fn().mockResolvedValue(null),
  distanceMeters: vi.fn(),
  ARRIVAL_THRESHOLD_METERS: 100,
}))

const appointment = {
  id: 'job-1',
  appointment_date: '2026-10-15',
  start_time: '12:00:00',
  end_time: '15:00:00',
  assigned_staff_user_id: 'david',
  status: 'booked',
  payment_status: 'unpaid',
  ops_customers: { full_name: 'Test Customer' },
  ops_appointment_line_items: [],
}
let canOverride = true
let saved: Record<string, unknown> | null
let saveError: string | null

beforeEach(() => {
  canOverride = true
  saved = null
  saveError = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/recurring-link-options')) {
        return Response.json({ templates: [] })
      }
      if (url === '/api/public/lead-sources') {
        return Response.json({ options: [] })
      }
      if (init?.method === 'PATCH') {
        saved = JSON.parse(String(init.body))
        return saveError
          ? Response.json({ error: saveError }, { status: 409 })
          : Response.json({ appointment: { ...appointment, ...saved } })
      }
      return Response.json({
        appointment: { ...appointment, ...(saveError ? {} : saved) },
        staff: [
          { id: 'david', display_name: 'David' },
          { id: 'charles', display_name: 'Charles' },
        ],
        can_override_conflict: canOverride,
      })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AppointmentDetail scheduling', () => {
  it('loads the assigned technician and saves reassignment with the new date', async () => {
    render(<AppointmentDetail appointmentId="job-1" />)
    const technician = await screen.findByLabelText('Technician')
    expect(technician).toHaveValue('david')
    fireEvent.change(technician, { target: { value: 'charles' } })
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-10-16' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Job' }))
    await waitFor(() =>
      expect(saved).toMatchObject({
        assigned_staff_user_id: 'charles',
        appointment_date: '2026-10-16',
        allow_conflict: false,
      }),
    )
    expect(await screen.findByText('Job saved.')).toBeInTheDocument()
    expect(technician).toHaveValue('charles')
  })

  it('lets an admin opt into double booking after a conflict without losing edits', async () => {
    saveError = 'Appointment overlaps an active appointment.'
    render(<AppointmentDetail appointmentId="job-1" />)
    fireEvent.change(await screen.findByLabelText('Technician'), {
      target: { value: 'charles' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Job' }))
    expect(await screen.findByText(saveError)).toBeInTheDocument()
    expect(screen.queryByText('Job saved.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Technician')).toHaveValue('charles')
    saveError = null
    fireEvent.click(screen.getByLabelText('Allow double booking'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Job' }))
    await waitFor(() =>
      expect(saved).toMatchObject({
        assigned_staff_user_id: 'charles',
        allow_conflict: true,
      }),
    )
    expect(await screen.findByText('Job saved.')).toBeInTheDocument()
    expect(screen.getByLabelText('Allow double booking')).not.toBeChecked()
  })

  it('allows clearing the technician and hides overrides from other roles', async () => {
    canOverride = false
    render(<AppointmentDetail appointmentId="job-1" />)
    fireEvent.change(await screen.findByLabelText('Technician'), {
      target: { value: '' },
    })
    expect(
      screen.queryByLabelText('Allow double booking'),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save Job' }))
    await waitFor(() =>
      expect(saved).toMatchObject({ assigned_staff_user_id: null }),
    )
  })
})
