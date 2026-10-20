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
    }: {
      jobs: unknown[]
      trackers: unknown[]
      points: unknown[]
    }) {
      return (
        <div
          data-testid="map"
          data-jobs={jobs.length}
          data-vehicles={trackers.length}
          data-points={points.length}
        />
      )
    },
}))
const clients: QueryClient[] = []
function show(day: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <FleetTrackerDashboard embedded day={day} />
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
    '/api/admin/fleet/daily-map?date=2026-10-19',
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
