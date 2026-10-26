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
  params.set('date', '2026-09-12')
  params.delete('view')
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

describe('early schedule hours', () => {
  it('starts at 9 AM by default and reveals 7 AM when toggled', async () => {
    mockSchedule(1)
    render(<OperationsSchedule />)

    await screen.findByRole('link', { name: /Saturday Customer/ })
    const earlyHoursToggle = screen.getByRole('switch', {
      name: 'Show schedule from 7 AM',
    })

    expect(earlyHoursToggle).toHaveAttribute('aria-checked', 'false')
    expect(
      screen.queryByRole('button', { name: /at 07:00$/ }),
    ).not.toBeInTheDocument()

    fireEvent.click(earlyHoursToggle)

    expect(earlyHoursToggle).toHaveAttribute('aria-checked', 'true')
    expect(
      screen.getAllByRole('button', { name: /at 07:00$/ }).length,
    ).toBeGreaterThan(0)
  })

  it.each([false, true])(
    'automatically reveals an 8 AM job with its real time (mobile: %s)',
    async (mobile) => {
      vi.mocked(window.matchMedia).mockReturnValue({
        matches: mobile,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaQueryList)
      params.set('view', 'day')
      mockSchedule(1, [{ ...saturdayJob, start_time: '08:00:00' }])
      const { container } = render(<OperationsSchedule />)

      await screen.findByRole('link', { name: /Saturday Customer/ })
      expect(screen.getByText('08:00 - 11:00')).toBeVisible()
      expect(
        screen.getByRole('switch', { name: 'Show schedule from 7 AM' }),
      ).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('button', { name: /at 07:00$/ })).toBeVisible()
      fireEvent.click(
        screen.getByRole('switch', { name: 'Show schedule from 7 AM' }),
      )
      expect(screen.getByRole('button', { name: /at 07:00$/ })).toBeVisible()
      expect(
        container.querySelector('[data-appointment-id="saturday-job"]'),
      ).toHaveStyle({ top: '90px' })
    },
  )

  it('returns to 9 AM on a normal day and restores early hours when navigating back', async () => {
    params.set('view', 'day')
    mockSchedule(1, [{ ...saturdayJob, start_time: '08:00:00' }])
    render(<OperationsSchedule />)
    await screen.findByText('08:00 - 11:00')

    fireEvent.click(
      screen.getByText('13', { selector: 'span' }).closest('button')!,
    )
    expect(
      screen.queryByRole('button', { name: /at 07:00$/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Show schedule from 7 AM' }),
    ).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(
      screen.getByText('12', { selector: 'span' }).closest('button')!,
    )
    await screen.findByText('08:00 - 11:00')
    expect(
      screen.getByRole('button', { name: /at 07:00$/ }),
    ).toBeInTheDocument()
  })

  it.each([
    { status: 'cancelled' },
    { is_subcontracted: true },
    { parked_at: '2026-09-11T12:00:00Z' },
    { appointment_date: '2026-09-11' },
  ])(
    'keeps 9 AM when an early job is outside the active schedule: %j',
    async (override) => {
      params.set('view', 'day')
      const fetchMock = mockSchedule(1, [
        { ...saturdayJob, start_time: '08:00:00', ...override },
      ])
      render(<OperationsSchedule />)
      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      await screen.findByRole('button', {
        name: 'Create on 2026-09-12 at 09:00',
      })
      expect(
        screen.getByRole('switch', { name: 'Show schedule from 7 AM' }),
      ).toHaveAttribute('aria-checked', 'false')
    },
  )

  it('expands the week for an early job on another technician’s calendar', async () => {
    mockSchedule(2, [
      {
        ...saturdayJob,
        appointment_date: '2026-09-10',
        start_time: '08:00:00',
        assigned_staff_user_id: 'staff-1',
      },
    ])
    render(<OperationsSchedule />)
    expect(await screen.findByText('08:00 - 11:00')).toBeVisible()
    expect(
      screen.getAllByRole('button', { name: /at 07:00$/ }).length,
    ).toBeGreaterThan(0)
  })

  it('reveals jobs even earlier than 7 AM without changing their displayed time', async () => {
    params.set('view', 'day')
    mockSchedule(1, [{ ...saturdayJob, start_time: '06:30:00' }])
    render(<OperationsSchedule />)
    expect(await screen.findByText('06:30 - 11:00')).toBeVisible()
    expect(
      screen.getByRole('button', { name: /at 06:00$/ }),
    ).toBeInTheDocument()
  })
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
        end_time: '13:00:00',
        status: 'completed',
        quoted_total: 0,
        lead_source: 'Google',
        booking_channel: 'admin',
        service_concern_id: null,
        ops_customers: {
          full_name: 'Ordinary Customer',
          business_name: null,
        },
        ops_service_addresses: {
          street_1: '456 Main Street',
          city: 'Monument',
          state: 'CO',
          zip_code: '80132',
        },
        ops_appointment_line_items: [
          {
            id: 'ordinary-line',
            name_snapshot: 'Carpet Cleaning',
            service_catalog_items: null,
          },
        ],
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

    const ordinaryCard = container.querySelector(
      '[data-appointment-id="ordinary-job"]',
    )
    expect(ordinaryCard).toBeInstanceOf(HTMLElement)
    if (!(ordinaryCard instanceof HTMLElement)) return

    expect(ordinaryCard.style.height).toBe('160px')
    expect(within(ordinaryCard).getByText('11:00 - 13:00')).toBeVisible()
    expect(
      within(ordinaryCard).getByText('456 Main Street, Monument'),
    ).toBeVisible()
    expect(within(ordinaryCard).getByText('Carpet Cleaning')).toBeVisible()
    expect(within(ordinaryCard).getByText('Lead: Google')).toBeVisible()
    expect(within(ordinaryCard).getByText('Booked: Admin')).toBeVisible()
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

describe('unscheduled job deletion', () => {
  it('deletes a parked job without a confirmation or customer notification', async () => {
    const confirmMock = vi.fn()
    vi.stubGlobal('confirm', confirmMock)
    const fetchMock = vi
      .fn()
      .mockImplementation(async (url: string, options?: RequestInit) => {
        if (
          url ===
            '/api/admin/ops/appointments/parked-job?notify_customer=false' &&
          options?.method === 'DELETE'
        ) {
          return { ok: true, json: async () => ({ success: true }) }
        }
        if (url === '/api/admin/ops/restoration/projects') {
          return { ok: true, json: async () => ({ projects: [] }) }
        }
        if (url === '/api/admin/ops/schedule/parked') {
          return {
            ok: true,
            json: async () => ({
              appointments: [
                {
                  id: 'parked-job',
                  duration_minutes: 60,
                  ops_customers: {
                    full_name: 'Judy Brown',
                    business_name: null,
                  },
                  ops_service_addresses: {
                    street_1: '7711 Barkway Ct',
                    city: 'Lone Tree',
                  },
                },
              ],
            }),
          }
        }
        if (url.startsWith('/api/admin/ops/schedule?')) {
          return {
            ok: true,
            json: async () => ({
              appointments: [],
              events: [],
              staff: [],
              currentUserRole: 'owner',
            }),
          }
        }
        return { ok: true, json: async () => ({ templates: [] }) }
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<OperationsSchedule />)

    expect(await screen.findByText('Judy Brown')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Delete Judy Brown from unscheduled jobs',
      }),
    )

    await waitFor(() =>
      expect(screen.queryByText('Judy Brown')).not.toBeInTheDocument(),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/ops/appointments/parked-job?notify_customer=false',
      { method: 'DELETE' },
    )
    expect(confirmMock).not.toHaveBeenCalled()
  })
})

describe('unscheduled customer contact', () => {
  function setup(
    contact = {
      phone: '+1 (555) 555-0100',
      email: 'judy@example.test',
      blocked: false,
      emailOptOut: false,
    },
  ) {
    const fetchMock = mockSchedule(1, [])
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/ops/restoration/projects')
        return { ok: true, json: async () => ({ projects: [] }) }
      if (url === '/api/admin/ops/schedule/parked')
        return {
          ok: true,
          json: async () => ({
            appointments: [
              {
                id: 'parked-job',
                duration_minutes: 120,
                contact,
                ops_customers: { full_name: 'Judy Brown', business_name: null },
                ops_service_addresses: {
                  street_1: '7711 Barkway Ct',
                  city: 'Lone Tree',
                },
              },
            ],
          }),
        }
      return original(url)
    })
    render(<OperationsSchedule />)
    return fetchMock
  }
  it('opens contact choices without arming a booking, then explicitly places the existing job', async () => {
    const fetchMock = setup()
    fireEvent.click(
      await screen.findByRole('button', { name: /Judy Brown.*needs a date/ }),
    )
    const panel = screen.getByRole('region', { name: 'Contact Judy Brown' })
    expect(
      within(panel).getByRole('link', { name: 'Call Judy Brown' }),
    ).toHaveAttribute('href', 'tel:+15555550100')
    expect(
      within(panel).getByRole('link', { name: 'Text Judy Brown' }),
    ).toHaveAttribute('href', '/admin/conversations?phone=%2B15555550100')
    expect(
      within(panel).getByRole('link', { name: 'Email Judy Brown' }),
    ).toHaveAttribute('href', 'mailto:judy@example.test')
    expect(screen.queryByText(/Placing:/)).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.every(
        (call) => !call[1]?.method || call[1].method === 'GET',
      ),
    ).toBe(true)
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Place on calendar' }),
    )
    expect(screen.getByText(/Placing: Judy Brown/)).toBeVisible()
    expect(
      screen.queryByRole('region', { name: 'Contact Judy Brown' }),
    ).not.toBeInTheDocument()
  })
  it('hides contact actions for a blacklisted customer without removing scheduling controls', async () => {
    setup({
      phone: '+15555550100',
      email: 'judy@example.test',
      blocked: true,
      emailOptOut: false,
    })
    fireEvent.click(
      await screen.findByRole('button', { name: /Judy Brown.*needs a date/ }),
    )
    const panel = screen.getByRole('region', { name: 'Contact Judy Brown' })
    expect(within(panel).queryByRole('link')).not.toBeInTheDocument()
    expect(within(panel).getByText(/customer is blacklisted/)).toBeVisible()
    expect(
      within(panel).getByRole('button', { name: 'Place on calendar' }),
    ).toBeEnabled()
  })
  it('respects email suppression while keeping the phone actions available', async () => {
    setup({
      phone: '+15555550100',
      email: 'judy@example.test',
      blocked: false,
      emailOptOut: true,
    })
    fireEvent.click(
      await screen.findByRole('button', { name: /Judy Brown.*needs a date/ }),
    )
    const panel = screen.getByRole('region', { name: 'Contact Judy Brown' })
    expect(
      within(panel).queryByRole('link', { name: 'Email Judy Brown' }),
    ).not.toBeInTheDocument()
    expect(
      within(panel).getByRole('link', { name: 'Call Judy Brown' }),
    ).toBeVisible()
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Close contact' }),
    )
    expect(
      screen.queryByRole('region', { name: 'Contact Judy Brown' }),
    ).not.toBeInTheDocument()
  })
})
