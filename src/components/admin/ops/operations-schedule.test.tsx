import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OperationsSchedule } from './operations-schedule'

const params = new URLSearchParams('date=2026-09-12')
const router = { push: vi.fn(), replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  useRouter: () => router,
}))

const saturdayJob = {
  id: 'saturday-job',
  appointment_date: '2026-09-12',
  start_time: '10:00:00',
  end_time: '11:00:00',
  status: 'booked',
  quoted_total: 100,
  kind: 'restoration',
  restoration_project_id: 'restoration-project',
  visit_type: 'monitor',
  ops_customers: { full_name: 'Saturday Customer', business_name: null },
  ops_service_addresses: null,
  ops_appointment_line_items: [],
  ops_invoices: null,
}

function mockSchedule(
  staffCount: number,
  appointments: unknown[] = [saturdayJob],
) {
  const staff = Array.from({ length: staffCount }, (_, i) => ({
    id: `staff-${i}`,
    user_id: `staff-${i}`,
    display_name: `Tech ${i + 1}`,
    default_open: true,
    is_active: true,
    role: 'technician',
    scheduling_priority: i,
  }))
  const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.startsWith('/api/admin/ops/schedule?')
        ? {
            appointments,
            events: [],
            staff,
            currentUserRole: 'owner',
          }
        : {},
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  )
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('collapsible weekend schedule', () => {
  it.each([0, 1, 2])(
    'opens and collapses weekends independently with %i staff',
    async (staffCount) => {
      mockSchedule(staffCount)
      const { container } = render(<OperationsSchedule />)
      await screen.findByTitle('1 on Saturday — click to open the day')
      const grid = container.querySelector(
        '[style*="grid-template-columns"]',
      ) as HTMLElement
      expect(grid.style.minWidth).toBe('1534px')
      expect(
        screen.getByRole('button', { name: 'Open Sunday' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Open Saturday' }),
      ).toHaveAttribute('aria-expanded', 'false')
      expect(
        screen.getByRole('link', { name: /Saturday Customer/ }),
      ).toHaveAttribute(
        'href',
        '/admin/operations/restoration/restoration-project?visit=saturday-job',
      )

      fireEvent.click(screen.getByRole('button', { name: 'Open Saturday' }))
      expect(grid.style.minWidth).toBe('1748px')
      expect(
        screen.getByRole('button', { name: 'Collapse Saturday' }),
      ).toHaveAttribute('aria-expanded', 'true')
      expect(
        screen.getByRole('button', { name: 'Open Sunday' }),
      ).toBeInTheDocument()
      expect(
        container.querySelectorAll('[data-date-column="2026-09-12"]').length,
      ).toBe(Math.max(staffCount, 1))

      fireEvent.click(screen.getByRole('button', { name: 'Open Sunday' }))
      expect(grid.style.minWidth).toBe('1962px')
      fireEvent.click(screen.getByRole('button', { name: 'Collapse Saturday' }))
      expect(grid.style.minWidth).toBe('1748px')
      expect(
        screen.getByRole('button', { name: 'Collapse Sunday' }),
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Collapse Sunday' }))
      expect(grid.style.minWidth).toBe('1534px')
      fireEvent.click(
        screen.getByTitle('1 on Saturday — click to open the day'),
      )
      expect(
        screen.getByRole('button', { name: 'Collapse Saturday' }),
      ).toBeInTheDocument()
    },
  )

  it.each([0, 2])(
    'keeps Saturday fully usable in day view with %i staff',
    async (staffCount) => {
      mockSchedule(staffCount)
      const { container } = render(<OperationsSchedule />)
      await screen.findByTitle('1 on Saturday — click to open the day')
      fireEvent.click(screen.getByRole('button', { name: /^day$/i }))
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Open Saturday' }),
        ).not.toBeInTheDocument(),
      )
      expect(
        screen.queryByRole('button', { name: 'Collapse Saturday' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByTitle('1 on Saturday — click to open the day'),
      ).not.toBeInTheDocument()
      expect(
        container.querySelectorAll('[data-date-column="2026-09-12"]').length,
      ).toBe(Math.max(staffCount, 1))
    },
  )

  it('keeps the collapsed Saturday column as a scheduling drop target', async () => {
    const fetchMock = mockSchedule(2)
    render(<OperationsSchedule />)
    const sliver = await screen.findByTitle(
      '1 on Saturday — click to open the day',
    )
    const drop = createEvent.drop(sliver, {
      dataTransfer: {
        getData: (key: string) =>
          key === 'appointmentId' ? saturdayJob.id : '',
      },
    })
    Object.defineProperties(drop, {
      clientY: { value: 84 },
      clientX: { value: 100 },
    })
    fireEvent(sliver, drop)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/ops/appointments/saturday-job',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            appointment_date: '2026-09-12',
            start_time: '10:00:00',
            assigned_staff_user_id: null,
          }),
        }),
      ),
    )
  })

  it('labels warranty returns without relabeling an ordinary unpaid $0 job', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    )
    mockSchedule(2, [
      {
        ...saturdayJob,
        id: 'warranty-job',
        kind: 'service',
        restoration_project_id: null,
        start_time: '10:00:00',
        end_time: '11:00:00',
        status: 'completed',
        assigned_staff_user_id: 'staff-0',
        lead_source: 'Repeat Customer',
        booking_channel: 'admin',
        service_concern_id: null,
        ops_service_addresses: {
          street_1: '123 Warranty Way',
          city: 'Palmer Lake',
          state: 'CO',
          zip_code: '80133',
        },
        ops_customers: {
          full_name: 'Warranty Customer',
          business_name: null,
        },
        ops_appointment_line_items: [
          {
            id: 'warranty-line',
            name_snapshot: 'Warranty Re-Clean',
            service_catalog_items: { slug: 'warranty-re-clean' },
          },
        ],
        ops_invoices: {
          id: 'warranty-invoice',
          status: 'ready',
          payment_status: 'waived',
          payment_method: null,
          total: 0,
        },
      },
      {
        ...saturdayJob,
        id: 'ordinary-job',
        start_time: '11:00:00',
        end_time: '12:00:00',
        status: 'completed',
        quoted_total: 0,
        service_concern_id: null,
        ops_customers: {
          full_name: 'Ordinary Customer',
          business_name: null,
        },
        ops_invoices: {
          id: 'ordinary-invoice',
          status: 'ready',
          payment_status: 'unpaid',
          payment_method: null,
          total: 0,
        },
      },
    ])

    const { container } = render(<OperationsSchedule />)

    expect(await screen.findByText('#Warranty clean')).toBeInTheDocument()
    expect(screen.getByText('Unpaid')).toBeInTheDocument()

    const warrantyCard = container.querySelector(
      '[data-warranty-appointment="true"]',
    )
    expect(warrantyCard).toBeInstanceOf(HTMLElement)
    if (!(warrantyCard instanceof HTMLElement)) return

    expect(warrantyCard.style.height).toBe('76px')
    expect(within(warrantyCard).getByText('Warranty Customer')).toBeVisible()
    expect(within(warrantyCard).getByText('#Warranty clean')).toHaveClass(
      'bg-rose-100',
      'text-rose-800',
    )
    expect(within(warrantyCard).getByText('Palmer Lake')).toBeVisible()
    expect(within(warrantyCard).queryByText(/Lead:/)).not.toBeInTheDocument()
    expect(within(warrantyCard).queryByText(/Booked:/)).not.toBeInTheDocument()
    expect(within(warrantyCard).queryByText('$0.00')).not.toBeInTheDocument()
    expect(
      within(warrantyCard).getByRole('link', {
        name: 'Open Warranty Customer warranty clean',
      }),
    ).toHaveAttribute('href', '/admin/operations/invoices/warranty-invoice')
    expect(
      within(warrantyCard).getByRole('button', {
        name: 'Move job to Tech 2',
      }),
    ).toBeVisible()
    expect(
      within(warrantyCard).getByTitle(
        'Drag Warranty Customer to move start time',
      ),
    ).toBeVisible()
  })
})

describe('commercial estimate scheduling', () => {
  it('offers a dedicated top action and prefilled calendar-cell action', async () => {
    mockSchedule(1, [])
    render(<OperationsSchedule />)

    const topAction = await screen.findByRole('link', {
      name: /Commercial Estimate/i,
    })
    expect(topAction).toHaveAttribute('href', '/admin/operations/estimates/new')

    fireEvent.click(screen.getByRole('button', { name: /^day$/i }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Create on 2026-09-12 at 10:00',
      }),
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Commercial estimate at this time',
      }),
    )

    expect(router.push).toHaveBeenCalledWith(
      '/admin/operations/estimates/new?date=2026-09-12&time=10%3A00&staff=staff-0',
    )
  })

  it('renders an amber commercial walkthrough card with business, contact, address, technician, and detail link', async () => {
    mockSchedule(1, [
      {
        ...saturdayJob,
        id: 'commercial-estimate',
        kind: 'estimate',
        restoration_project_id: null,
        visit_type: null,
        estimate_status: 'draft',
        quoted_total: 0,
        assigned_staff_user_id: 'staff-0',
        ops_customers: {
          full_name: 'Riley Park',
          business_name: 'High Plains Dental',
          phone: '+17195550123',
        },
        ops_service_addresses: {
          street_1: '200 Commerce Dr',
          city: 'Monument',
          state: 'CO',
          zip_code: '80132',
        },
      },
    ])
    render(<OperationsSchedule />)

    await screen.findByTitle('1 on Saturday — click to open the day')
    fireEvent.click(screen.getByRole('button', { name: /^day$/i }))

    const cardLink = await screen.findByRole('link', {
      name: /High Plains Dental/i,
    })
    expect(cardLink).toHaveAttribute(
      'href',
      '/admin/operations/estimates/commercial-estimate',
    )
    expect(cardLink).toHaveTextContent('Commercial walkthrough')
    expect(cardLink).toHaveTextContent('Contact: Riley Park')
    expect(cardLink).toHaveTextContent('200 Commerce Dr, Monument')
    expect(cardLink).toHaveTextContent('Tech: Tech 1')
    expect(cardLink).toHaveTextContent('Draft')
  })
})
