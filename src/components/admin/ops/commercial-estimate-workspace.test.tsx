import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommercialEstimateWorkspace } from './commercial-estimate-workspace'

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  router: { push: vi.fn(), refresh: vi.fn() },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.params,
}))

type Slot = { start_time: string; end_time: string }
let submittedBody: Record<string, unknown> | null = null
let slotMap: Record<string, Slot[]> = {}
let requestedUrls: string[] = []

const staff = [
  { id: 'staff-a', display_name: 'Charles', default_open: true },
  { id: 'staff-b', display_name: 'David Gonzalez', default_open: true },
]

beforeEach(() => {
  vi.clearAllMocks()
  navigation.params = new URLSearchParams(
    'date=2026-09-23&time=11:00&staff=staff-a',
  )
  submittedBody = null
  requestedUrls = []
  slotMap = {
    '2026-09-23|staff-a': [{ start_time: '11:00:00', end_time: '13:00:00' }],
    '2026-09-23|staff-b': [{ start_time: '13:00:00', end_time: '15:00:00' }],
    '2026-09-24|staff-a': [{ start_time: '09:00:00', end_time: '11:00:00' }],
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requestedUrls.push(url)
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
            staff,
            appointments: [
              {
                id: 'existing-job',
                appointment_date: '2026-09-23',
                start_time: '09:00:00',
                end_time: '11:00:00',
                assigned_staff_user_id: 'staff-a',
                ops_customers: {
                  full_name: 'Existing Customer',
                  business_name: null,
                },
                ops_appointment_line_items: [
                  { name_snapshot: 'Carpet cleaning' },
                ],
              },
            ],
            dailyAvailability: [],
          }),
        }
      }
      if (url.startsWith('/api/admin/ops/month-availability?')) {
        return {
          ok: true,
          json: async () => ({
            days: [
              { date: '2026-09-23', slots: 1 },
              { date: '2026-09-24', slots: 1 },
            ],
            commercial_days: {},
          }),
        }
      }
      if (url.startsWith('/api/admin/ops/slots?')) {
        const query = new URL(url, 'https://example.com').searchParams
        const key = `${query.get('date')}|${query.get('staff_user_id')}`
        return {
          ok: true,
          json: async () => ({ slots: slotMap[key] || [] }),
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

function fillRequiredBusinessFields() {
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
}

describe('commercial estimate scheduling', () => {
  it('keeps a valid schedule-cell prefill selected and reserves exactly two hours', async () => {
    render(<CommercialEstimateWorkspace />)

    expect(
      await screen.findByRole('button', { name: /11:00 AM.*1:00 PM/ }),
    ).toHaveTextContent('Selected')
    expect(screen.getByLabelText('Assigned technician *')).toHaveValue(
      'staff-a',
    )
    expect(screen.getByText('Existing Customer')).toBeInTheDocument()
    expect(
      screen.getByText(/60 min.*60 min travel.*120 min/),
    ).toBeInTheDocument()
    expect(
      requestedUrls.some(
        (url) =>
          url.startsWith('/api/admin/ops/slots?') &&
          url.includes('required_minutes=120') &&
          !url.includes('required_minutes=180'),
      ),
    ).toBe(true)

    fillRequiredBusinessFields()
    fireEvent.click(
      screen.getByRole('button', { name: 'Schedule commercial estimate' }),
    )

    await waitFor(() =>
      expect(navigation.router.push).toHaveBeenCalledWith(
        '/admin/operations?date=2026-09-23&view=day&appointment=appointment-new',
      ),
    )
    expect(submittedBody).toMatchObject({
      appointment_date: '2026-09-23',
      start_time: '11:00',
      assigned_staff_user_id: 'staff-a',
      lead_source: 'google_search',
    })
    expect(submittedBody).not.toHaveProperty('quoted_total')
    expect(submittedBody).not.toHaveProperty('invoice')
  })

  it('shows multiple technicians and refreshes selectable slots when staff changes', async () => {
    render(<CommercialEstimateWorkspace />)
    await screen.findByRole('button', { name: /11:00 AM.*1:00 PM/ })

    expect(screen.getByLabelText('Assigned technician *')).toHaveTextContent(
      'David Gonzalez',
    )
    fireEvent.change(screen.getByLabelText('Assigned technician *'), {
      target: { value: 'staff-b' },
    })

    expect(
      await screen.findByRole('button', { name: /1:00 PM.*3:00 PM/ }),
    ).toHaveTextContent('Selected')
    expect(
      requestedUrls.some(
        (url) =>
          url.startsWith('/api/admin/ops/slots?') &&
          url.includes('staff_user_id=staff-b'),
      ),
    ).toBe(true)
  })

  it('turns an unavailable day into calendar navigation to the next open day', async () => {
    slotMap['2026-09-23|staff-a'] = []
    render(<CommercialEstimateWorkspace />)

    expect(
      await screen.findByText(/No opening long enough on this day/),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '2026-09-24' }))

    expect(
      await screen.findByRole('button', { name: /9:00 AM.*11:00 AM/ }),
    ).toHaveTextContent('Selected')
  })

  it('flags a stale schedule-cell time and requires a live opening instead', async () => {
    navigation.params = new URLSearchParams(
      'date=2026-09-23&time=10:00&staff=staff-a',
    )
    render(<CommercialEstimateWorkspace />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '10:00 AM is no longer available',
    )
    const open = screen.getByRole('button', { name: /11:00 AM.*1:00 PM/ })
    expect(open).toHaveTextContent('Available')
    fireEvent.click(open)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(open).toHaveTextContent('Selected')
  })
})
