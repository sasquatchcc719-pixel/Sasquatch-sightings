import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TechClockControl } from './tech-clock-control'

function clockStatus(clockState: 'active' | 'on_break') {
  return {
    entry: {
      id: 'entry-1',
      startedAt: '2026-10-02T15:00:00.000Z',
      endedAt: '2026-10-02T15:00:00.000Z',
      breakMinutes: 0,
      payableMinutes: 60,
      clockState,
    },
    recentClockOut: null,
  }
}

function mockClock(clockState: 'active' | 'on_break') {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(clockStatus(clockState)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TechClockControl break confirmation', () => {
  it('does not start a break until the technician confirms', async () => {
    const fetchMock = mockClock('active')
    render(<TechClockControl />)

    fireEvent.click(await screen.findByRole('button', { name: 'Start Break' }))

    expect(
      screen.getByText('Are you sure you want to start your break?'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Yes, start break' }),
    ).toBeDisabled()
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)

    const confirmButton = screen.getByRole('button', {
      name: 'Yes, start break',
    })
    await waitFor(() => expect(confirmButton).toBeEnabled(), { timeout: 2_000 })
    fireEvent.click(confirmButton)

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => {
          if (init?.method !== 'POST') return false
          return JSON.parse(String(init.body)).action === 'start_break'
        }),
      ).toBe(true),
    )
  })

  it('does not end a break until the technician confirms', async () => {
    const fetchMock = mockClock('on_break')
    render(<TechClockControl />)

    fireEvent.click(await screen.findByRole('button', { name: 'End Break' }))

    expect(
      screen.getByText('Are you sure you want to end your break?'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Yes, end break' }),
    ).toBeDisabled()
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)

    const confirmButton = screen.getByRole('button', {
      name: 'Yes, end break',
    })
    await waitFor(() => expect(confirmButton).toBeEnabled(), { timeout: 2_000 })
    fireEvent.click(confirmButton)

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => {
          if (init?.method !== 'POST') return false
          return JSON.parse(String(init.body)).action === 'end_break'
        }),
      ).toBe(true),
    )
  })
})

describe('TechClockControl truck reminder', () => {
  function mockWeather(lowF: number | null, fail = false) {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === '/api/tech/truck-weather') {
          if (fail) throw new Error('offline')
          return new Response(
            JSON.stringify({
              lowF,
              cold: lowF !== null && lowF <= 33,
              forecastUpdatedAt: '2026-10-16T22:00:00Z',
            }),
          )
        }
        if (init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              entry: null,
              recentClockOut: {
                id: 'entry-1',
                startedAt: '2026-10-16T15:00:00Z',
                endedAt: new Date().toISOString(),
                canUndoUntil: new Date(Date.now() + 600_000).toISOString(),
                clockInAllowedAt: new Date(Date.now() + 90_000).toISOString(),
                payableMinutes: 60,
              },
            }),
          )
        }
        return new Response(JSON.stringify(clockStatus('active')))
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('shows the cold warning before clock-out and retains it afterward', async () => {
    const fetchMock = mockWeather(33)
    render(<TechClockControl />)
    fireEvent.click(await screen.findByRole('button', { name: 'Clock Out' }))
    expect(
      await screen.findByText('Palmer Lake overnight low: 33°F'),
    ).toBeInTheDocument()
    expect(screen.getByText('Put a heater in the truck.')).toBeInTheDocument()
    expect(
      screen.getByText('Close and latch the back door.'),
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)
    const confirmButton = screen.getByRole('button', { name: 'Yes, clock out' })
    await waitFor(() => expect(confirmButton).toBeEnabled(), { timeout: 2_000 })
    fireEvent.click(confirmButton)
    await screen.findByRole('button', { name: 'Undo Clock Out' })
    expect(
      await screen.findByText('Put a heater in the truck.'),
    ).toBeInTheDocument()
  })

  it('shows the low without a heater warning above 33°F', async () => {
    mockWeather(34)
    render(<TechClockControl />)
    fireEvent.click(await screen.findByRole('button', { name: 'Clock Out' }))
    expect(
      await screen.findByText('Palmer Lake overnight low: 34°F'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Put a heater in the truck.'),
    ).not.toBeInTheDocument()
  })

  it.each([false, true])(
    'keeps clock-out available with an explicit forecast fallback (network error: %s)',
    async (fail) => {
      mockWeather(null, fail)
      render(<TechClockControl />)
      fireEvent.click(await screen.findByRole('button', { name: 'Clock Out' }))
      expect(
        await screen.findByText(/Overnight forecast unavailable/),
      ).toHaveTextContent('33°F or colder')
      await waitFor(
        () =>
          expect(
            screen.getByRole('button', { name: 'Yes, clock out' }),
          ).toBeEnabled(),
        { timeout: 2_000 },
      )
    },
  )
})
