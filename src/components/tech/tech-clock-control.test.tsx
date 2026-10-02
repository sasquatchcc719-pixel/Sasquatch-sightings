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
