import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const map = vi.hoisted(() => ({
  load: () => {},
  setData: vi.fn(),
  setRecordedData: vi.fn(),
  setPaintProperty: vi.fn(),
  fitBounds: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('mapbox-gl', () => ({
  default: {
    Map: class {
      addControl() {}
      on(_event: string, callback: () => void) {
        map.load = callback
      }
      addSource() {}
      addLayer() {}
      getSource(id: string) {
        return {
          setData:
            id === 'canvass-recorded' ? map.setRecordedData : map.setData,
        }
      }
      getLayer() {
        return true
      }
      setPaintProperty = map.setPaintProperty
      fitBounds = map.fitBounds
      remove = map.remove
    },
    NavigationControl: class {},
    LngLatBounds: class {
      extend() {
        return this
      }
    },
  },
}))

import { CanvassCoverageMap } from './CanvassCoverageMap'

const payload = {
  geojson: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { sessionId: 'walk' },
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [
              [-104.87, 39],
              [-104.87, 39.001],
            ],
          ],
        },
      },
    ],
  },
  sessions: [{ id: 'walk' }],
}
const selected = {
  sessions: [
    {
      id: 'walk',
      user_name: 'David',
      started_at: '2026-09-01T21:39:56Z',
      ended_at: '2026-09-02T18:13:00Z',
      gps_distance_m: 18067,
      coverage_distance_m: 1919,
      gap_distance_m: 16148,
      gap_count: 2,
      point_count: 260,
    },
  ],
  recorded_geojson: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'connections' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-104.87, 39],
            [-104.7, 39.1],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { kind: 'samples' },
        geometry: {
          type: 'MultiPoint',
          coordinates: [
            [-104.87, 39],
            [-104.7, 39.1],
          ],
        },
      },
    ],
  },
}

describe('coverage map refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'test-token')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => payload }),
    )
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('defaults to all time and refreshes saved coverage without moving the map every 30 seconds', async () => {
    const onSessions = vi.fn()
    const { unmount } = render(<CanvassCoverageMap onSessions={onSessions} />)
    await act(async () => map.load())
    expect(fetch).toHaveBeenCalledWith(
      '/api/field/canvass/coverage?days=0',
      expect.objectContaining({ cache: 'no-store' }),
    )
    expect(map.setData).toHaveBeenCalledWith(payload.geojson)
    expect(onSessions).toHaveBeenCalledWith(payload.sessions)
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(map.setData).toHaveBeenCalledTimes(2)
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    unmount()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(map.remove).toHaveBeenCalledTimes(1)
  })

  it('shows a failed load and clears the error after a successful refresh', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'GPS unavailable' }),
    } as Response)
    render(<CanvassCoverageMap />)
    await act(async () => map.load())
    expect(screen.getByText('GPS unavailable')).toBeTruthy()
    expect(map.setData).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(screen.queryByText('GPS unavailable')).toBeNull()
    expect(map.setData).toHaveBeenCalledWith(payload.geojson)
  })

  it('ignores stale responses when the date filter changes', async () => {
    let resolveOld!: (value: Response) => void
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }) as Promise<Response>,
    )
    const { rerender } = render(<CanvassCoverageMap days={7} />)
    await act(async () => map.load())
    rerender(<CanvassCoverageMap days={0} />)
    await act(async () => {})
    await act(async () => {
      resolveOld({
        ok: true,
        json: async () => ({ geojson: { features: [] }, sessions: [] }),
      } as Response)
    })
    expect(map.setData).toHaveBeenCalledTimes(1)
    expect(map.setData).toHaveBeenLastCalledWith(payload.geojson)
  })

  it('shows raw GPS and distance breakdown for a selected track, then restores all coverage', async () => {
    vi.mocked(fetch).mockImplementation(
      async (url) =>
        ({
          ok: true,
          json: async () =>
            String(url).includes('sessionId=') ? selected : payload,
        }) as Response,
    )
    const clear = vi.fn()
    const { rerender } = render(<CanvassCoverageMap onClearFocus={clear} />)
    await act(async () => map.load())
    rerender(<CanvassCoverageMap focusSessionId="walk" onClearFocus={clear} />)
    await act(async () => {})
    expect(map.setRecordedData).toHaveBeenLastCalledWith(
      selected.recorded_geojson,
    )
    expect(map.setData).toHaveBeenCalledTimes(1)
    expect(screen.getByText('11.23 mi')).toBeTruthy()
    expect(screen.getByText('1.19 mi')).toBeTruthy()
    expect(screen.getByText('10.03 mi')).toBeTruthy()
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ maxZoom: 17 }),
    )
    const zoomCount = map.fitBounds.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(map.fitBounds).toHaveBeenCalledTimes(zoomCount)
    fireEvent.click(screen.getByRole('button', { name: 'Show all coverage' }))
    expect(clear).toHaveBeenCalledTimes(1)
    rerender(<CanvassCoverageMap onClearFocus={clear} />)
    expect(map.setRecordedData).toHaveBeenLastCalledWith({
      type: 'FeatureCollection',
      features: [],
    })
    expect(map.setPaintProperty).toHaveBeenLastCalledWith(
      'canvass-centerline',
      'line-opacity',
      0.9,
    )
    expect(screen.queryByRole('region', { name: 'Selected track' })).toBeNull()
  })

  it('keeps the selected track in view when the main coverage request arrives later', async () => {
    let resolveCoverage!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => {
      resolveCoverage = resolve
    })
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).includes('sessionId=')
        ? ({ ok: true, json: async () => selected } as Response)
        : pending,
    )
    render(<CanvassCoverageMap focusSessionId="walk" />)
    await act(async () => map.load())
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveCoverage({ ok: true, json: async () => payload } as Response)
    })
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
  })

  it('shows a selected-track error instead of silently doing nothing', async () => {
    vi.mocked(fetch).mockImplementation(
      async (url) =>
        ({
          ok: !String(url).includes('sessionId='),
          json: async () =>
            String(url).includes('sessionId=')
              ? { error: 'Walk not found' }
              : payload,
        }) as Response,
    )
    render(<CanvassCoverageMap focusSessionId="missing" />)
    await act(async () => map.load())
    expect(screen.getByRole('alert').textContent).toBe('Walk not found')
  })
})
