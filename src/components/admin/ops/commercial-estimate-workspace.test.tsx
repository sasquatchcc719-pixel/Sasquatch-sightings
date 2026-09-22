import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CommercialEstimateWorkspace } from './commercial-estimate-workspace'

const router = { push: vi.fn(), refresh: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () =>
    new URLSearchParams(
      'date=2026-09-23&time=11:00&staff=11111111-1111-4111-8111-111111111111',
    ),
}))

let submittedBody: Record<string, unknown> | null = null

beforeEach(() => {
  vi.clearAllMocks()
  submittedBody = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/public/lead-sources') {
        return {
          ok: true,
          json: async () => ({
            options: [
              {
                key: 'google_search',
                value: 'google_search',
                customer_label: 'Google Search / Maps',
                label: 'Google Search / Maps',
                requires_detail: false,
                detail_label: null,
              },
            ],
          }),
        }
      }
      if (url.startsWith('/api/admin/ops/schedule?')) {
        return {
          ok: true,
          json: async () => ({
            staff: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                display_name: 'Charles',
              },
            ],
          }),
        }
      }
      if (url.startsWith('/api/admin/ops/slots?')) {
        return {
          ok: true,
          json: async () => ({
            slots: [{ start_time: '11:00:00', end_time: '13:00:00' }],
          }),
        }
      }
      if (url === '/api/admin/ops/estimates' && init?.method === 'POST') {
        submittedBody = JSON.parse(String(init.body)) as Record<string, unknown>
        return {
          ok: true,
          json: async () => ({ appointment_id: 'appointment-new' }),
        }
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('prefills the calendar slot and schedules a new commercial business without residential quote fields', async () => {
  render(<CommercialEstimateWorkspace />)

  expect(screen.getByLabelText('Date *')).toHaveValue('2026-09-23')
  expect(await screen.findByRole('button', { name: '11:00 AM' })).toHaveClass(
    'bg-primary',
  )
  expect(screen.getByLabelText('Assigned technician *')).toHaveValue(
    '11111111-1111-4111-8111-111111111111',
  )

  fireEvent.change(screen.getByLabelText('Business name *'), {
    target: { value: 'High Plains Dental' },
  })
  fireEvent.change(screen.getByLabelText('Contact first name *'), {
    target: { value: 'Riley' },
  })
  fireEvent.change(screen.getByLabelText('Contact last name *'), {
    target: { value: 'Park' },
  })
  fireEvent.change(screen.getByLabelText('Phone *'), {
    target: { value: '(719) 555-0123' },
  })
  fireEvent.change(screen.getByLabelText('Email *'), {
    target: { value: 'riley@example.com' },
  })
  fireEvent.change(screen.getByLabelText('Street address *'), {
    target: { value: '10 N Cascade Ave' },
  })
  fireEvent.change(screen.getByLabelText('ZIP *'), {
    target: { value: '80903' },
  })
  fireEvent.change(screen.getByLabelText('What needs to be quoted? *'), {
    target: { value: 'Measure offices and hallways.' },
  })
  fireEvent.change(screen.getByLabelText('Lead source *'), {
    target: { value: 'google_search' },
  })

  fireEvent.click(
    screen.getByRole('button', { name: 'Schedule commercial estimate' }),
  )

  await waitFor(() =>
    expect(router.push).toHaveBeenCalledWith(
      '/admin/operations?date=2026-09-23&view=day&appointment=appointment-new',
    ),
  )
  expect(submittedBody).toMatchObject({
    customer_id: null,
    service_address_id: null,
    appointment_date: '2026-09-23',
    start_time: '11:00',
    assigned_staff_user_id: '11111111-1111-4111-8111-111111111111',
    lead_source: 'google_search',
  })
  expect(submittedBody).not.toHaveProperty('quoted_total')
  expect(submittedBody).not.toHaveProperty('invoice')
})
