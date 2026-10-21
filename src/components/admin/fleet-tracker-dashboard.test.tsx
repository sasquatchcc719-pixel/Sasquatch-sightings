import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import FleetTrackerDashboard from './fleet-tracker-dashboard'
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('next/dynamic', () => ({
  default: () =>
    function MapBoundary({
      jobs,
      trackers,
      points,
      plannedDrives,
    }: {
      jobs: unknown[]
      trackers: unknown[]
      points: unknown[]
      plannedDrives: unknown[]
    }) {
      return (
        <div
          data-testid="map"
          data-jobs={jobs.length}
          data-vehicles={trackers.length}
          data-points={points.length}
          data-planned={plannedDrives.length}
        />
      )
    },
}))
const clients: QueryClient[] = []
function show(day: string, staffFilter: string | null = null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <FleetTrackerDashboard embedded day={day} staffFilter={staffFilter} />
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-19T20:00:00Z'))
  mocks.fetch.mockReset().mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes('daily-map?')
        ? {
            date: '2026-10-19',
            defaultStaffId: 'staff1',
            jobs: [
              {
                id: 'job1',
                date: '2026-10-19',
                start: '10:00:00',
                end: '11:00:00',
                name: 'Example job',
                address: 'Example address',
                staffId: 'staff1',
                staffName: 'Example technician',
                status: 'booked',
                href: '/admin/operations/appointments/job1',
                location: {
                  lat: 39.15,
                  lng: -104.87,
                  source: 'Verified address',
                },
              },
            ],
          }
        : url.includes('/history?')
          ? {
              points: [
                {
                  recorded_at: '2026-10-19T14:00:00Z',
                  latitude: 39.15,
                  longitude: -104.87,
                  speed_mps: 2,
                  bearing: 0,
                },
                {
                  recorded_at: '2026-10-19T14:00:30Z',
                  latitude: 39.151,
                  longitude: -104.87,
                  speed_mps: 2,
                  bearing: 0,
                },
              ],
            }
          : {
              trackers: [
                {
                  id: 'van1',
                  name: 'Example van',
                  enabled: true,
                  gps_fix: true,
                  gps_at: '2026-10-19T20:00:00Z',
                  last_seen_at: '2026-10-19T20:00:00Z',
                  latitude: 39.16,
                  longitude: -104.87,
                  speed_mps: 0,
                },
              ],
            },
  }))
  vi.stubGlobal('fetch', mocks.fetch)
})
afterEach(() => {
  cleanup()
  for (const c of clients) c.clear()
  clients.length = 0
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
it('uses the calendar day for job pins and keeps driving tracks hidden until requested', async () => {
  show('2026-10-19')
  await screen.findByRole('link', { name: /Example job/ })
  expect(mocks.fetch).toHaveBeenCalledWith(
    '/api/admin/fleet/daily-map?date=2026-10-19&routes=1',
    expect.anything(),
  )
  expect(screen.getByTestId('map')).toHaveAttribute('data-jobs', '1')
  expect(screen.getByTestId('map')).toHaveAttribute('data-points', '0')
  expect(
    mocks.fetch.mock.calls.some(([url]) => url.includes('/history?')),
  ).toBe(false)
  const details = screen
    .getByText('Driving history · 2026-10-19')
    .closest('details')!
  details.open = true
  fireEvent(details, new Event('toggle'))
  await waitFor(() =>
    expect(screen.getByTestId('map')).toHaveAttribute('data-points', '2'),
  )
  expect(screen.getByText(/2 recorded GPS samples/)).toBeVisible()
  details.open = false
  fireEvent(details, new Event('toggle'))
  await waitFor(() =>
    expect(screen.getByTestId('map')).toHaveAttribute('data-points', '0'),
  )
})
it.each(['2026-10-18', '2026-10-20'])(
  'does not show current vehicle locations on %s',
  async (day) => {
    show(day)
    await screen.findByRole('link', { name: /Example job/ })
    expect(screen.getByTestId('map')).toHaveAttribute('data-vehicles', '0')
    expect(
      screen.queryByRole('button', { name: /Example van/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/Current vehicle locations are hidden/),
    ).toBeVisible()
  },
)
it('shows scheduled road estimates while keeping actual vehicle history hidden', async () => {
  const base = mocks.fetch.getMockImplementation()!
  mocks.fetch.mockImplementation(async (url: string) => {
    const response = await base(url)
    if (!url.includes('daily-map?')) return response
    const data = await response.json()
    return {
      ok: true,
      json: async () => ({
        ...data,
        jobs: [
          ...data.jobs,
          {
            ...data.jobs[0],
            id: 'job2',
            name: 'Afternoon job',
            start: '14:00:00',
            end: '15:00:00',
          },
        ],
        plannedDrives: [
          {
            fromJobId: null,
            toJobId: 'job1',
            staffId: 'staff1',
            seconds: 600,
            meters: 2000,
            coordinates: [],
            error: null,
          },
          {
            fromJobId: 'job2',
            toJobId: null,
            staffId: 'staff1',
            seconds: 900,
            meters: 3000,
            coordinates: [],
            error: null,
          },
          {
            fromJobId: null,
            toJobId: 'hidden-job',
            staffId: 'staff2',
            seconds: 10000,
            meters: 30000,
            coordinates: [],
            error: null,
          },
          {
            fromJobId: 'job1',
            toJobId: 'job2',
            staffId: 'staff1',
            seconds: 742,
            meters: 8500,
            coordinates: [
              [-104.8, 39.1],
              [-104.9, 39.2],
            ],
            error: null,
          },
        ],
      }),
    }
  })
  show('2026-10-19', 'staff1')
  expect(await screen.findByText('13 min estimated · 5.3 mi')).toBeVisible()
  expect(screen.getByText('1 → 2 · Example job → Afternoon job')).toBeVisible()
  expect(screen.getByText('Base → 1 · Base → Example job')).toBeVisible()
  expect(screen.getByText('2 → Base · Afternoon job → Base')).toBeVisible()
  expect(screen.getByText('38 min')).toBeVisible()
  expect(screen.getByTestId('map')).toHaveAttribute('data-planned', '3')
  expect(screen.getByTestId('map')).toHaveAttribute('data-points', '0')
})

it('switches days inside the embedded map with the picker, arrows and Today, clearing old GPS overlays', async () => {
  show('2026-10-19')
  await screen.findByRole('link', { name: /Example job/ })
  const picker = screen.getByLabelText('Dispatch date')
  expect(picker).toHaveValue('2026-10-19')
  const history = screen
    .getByText('Driving history · 2026-10-19')
    .closest('details')!
  history.open = true
  fireEvent(history, new Event('toggle'))
  await waitFor(() =>
    expect(screen.getByTestId('map')).toHaveAttribute('data-points', '2'),
  )

  fireEvent.click(screen.getByRole('button', { name: 'Next dispatch day' }))
  await waitFor(() =>
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/admin/fleet/daily-map?date=2026-10-20&routes=1',
      expect.anything(),
    ),
  )
  expect(picker).toHaveValue('2026-10-20')
  expect(screen.getByText('Tuesday, October 20, 2026')).toBeVisible()
  expect(history).not.toHaveAttribute('open')
  expect(screen.getByTestId('map')).toHaveAttribute('data-points', '0')
  expect(screen.getByTestId('map')).toHaveAttribute('data-vehicles', '0')

  fireEvent.click(screen.getByRole('button', { name: 'Previous dispatch day' }))
  expect(picker).toHaveValue('2026-10-19')
  fireEvent.change(picker, { target: { value: '2026-11-01' } })
  await waitFor(() =>
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/admin/fleet/daily-map?date=2026-11-01&routes=1',
      expect.anything(),
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Previous dispatch day' }))
  await waitFor(() =>
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/admin/fleet/daily-map?date=2026-10-31&routes=1',
      expect.anything(),
    ),
  )
  expect(picker).toHaveValue('2026-10-31')
  fireEvent.click(screen.getByRole('button', { name: 'Today' }))
  expect(picker).toHaveValue('2026-10-19')
  expect(screen.getByText('Monday, October 19, 2026')).toBeVisible()
})
