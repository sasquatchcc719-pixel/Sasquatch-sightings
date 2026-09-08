import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
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

function mockSchedule(staffCount: number) {
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
        ? { appointments: [saturdayJob], events: [], staff }
        : {},
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
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
})
