import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const map = vi.hoisted(() => ({
  load: () => {},
  setData: vi.fn(),
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
      getSource() {
        return { setData: map.setData }
      }
      getLayer() {
        return false
      }
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
})
