import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TruckWeatherCard } from './truck-weather-card'

function forecast(lowF: number | null) {
  return new Response(
    JSON.stringify({
      lowF,
      cold: lowF !== null && lowF <= 33,
      forecastUpdatedAt: '2026-10-16T22:00:00Z',
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('dashboard truck weather', () => {
  it('shows the overnight low and heater warning as soon as the dashboard opens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(forecast(33))
    vi.stubGlobal('fetch', fetchMock)
    render(<TruckWeatherCard />)
    expect(await screen.findByText('33°F')).toBeInTheDocument()
    expect(screen.getByText('Protect the truck tonight')).toBeInTheDocument()
    expect(screen.getByText(/Put a heater in the truck/)).toHaveTextContent(
      'Close and latch the back door.',
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tech/truck-weather',
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('shows the forecast without a cold warning above 33°F', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(forecast(34)))
    render(<TruckWeatherCard />)
    expect(await screen.findByText('34°F')).toBeInTheDocument()
    expect(
      screen.queryByText('Protect the truck tonight'),
    ).not.toBeInTheDocument()
  })

  it.each(['network', 'http', 'missing'])(
    'shows a manual check reminder when weather fails: %s',
    async (failure) => {
      const fetchMock =
        failure === 'network'
          ? vi.fn().mockRejectedValue(new Error('offline'))
          : vi
              .fn()
              .mockResolvedValue(
                failure === 'http'
                  ? new Response('{}', { status: 503 })
                  : forecast(null),
              )
      vi.stubGlobal('fetch', fetchMock)
      render(<TruckWeatherCard />)
      expect(await screen.findByText(/Forecast unavailable/)).toHaveTextContent(
        '33°F or colder',
      )
      expect(
        screen.getByRole('button', { name: 'Refresh Palmer Lake weather' }),
      ).toBeEnabled()
    },
  )

  it('refreshes automatically during the day and stops polling on unmount', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(forecast(40))
      .mockImplementation(async () => forecast(32))
    vi.stubGlobal('fetch', fetchMock)
    let unmount!: () => void
    await act(async () => {
      unmount = render(<TruckWeatherCard />).unmount
    })
    expect(screen.getByText('40°F')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000)
    })
    expect(screen.getByText('32°F')).toBeInTheDocument()
    expect(screen.getByText('Protect the truck tonight')).toBeInTheDocument()
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refreshes when the dashboard returns to the foreground', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(forecast(40))
      .mockImplementation(async () => forecast(33))
    vi.stubGlobal('fetch', fetchMock)
    render(<TruckWeatherCard />)
    await screen.findByText('40°F')
    fireEvent(document, new Event('visibilitychange'))
    expect(await screen.findByText('33°F')).toBeInTheDocument()
  })

  it('supports retry and clears a previous forecast when refresh fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(forecast(40))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(forecast(33))
    vi.stubGlobal('fetch', fetchMock)
    render(<TruckWeatherCard />)
    await screen.findByText('40°F')
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh Palmer Lake weather' }),
    )
    await screen.findByText(/Forecast unavailable/)
    expect(screen.queryByText('40°F')).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh Palmer Lake weather' }),
    )
    expect(await screen.findByText('33°F')).toBeInTheDocument()
  })
})
