import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvassTracker } from './useCanvassTracker'

vi.mock('@/lib/gps/wakeLock', () => ({
  requestWakeLock: vi.fn(),
  releaseWakeLock: vi.fn(),
}))
const startedAt = '2026-10-19T12:00:00Z'
let position: PositionCallback
let fetchMock: ReturnType<typeof vi.fn>
let clearWatch: ReturnType<typeof vi.fn>
let enabled: boolean
let autoStopped: boolean
let offline: boolean
let lastPoint: any
let pointsPayloads: any[]
function fix(meters: number, seconds: number, accuracy = 5) {
  act(() =>
    position({
      coords: {
        latitude: 39 + meters / 111195,
        longitude: -104.87,
        accuracy,
        speed: null,
      },
      timestamp: Date.parse(startedAt) + seconds * 1000,
    } as GeolocationPosition),
  )
}
beforeEach(() => {
  enabled = true
  autoStopped = true
  offline = false
  lastPoint = null
  pointsPayloads = []
  const stash = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stash.get(key) ?? null,
    setItem: (key: string, value: string) => stash.set(key, value),
    removeItem: (key: string) => stash.delete(key),
  })
  clearWatch = vi.fn()
  vi.stubGlobal('navigator', {
    geolocation: {
      watchPosition: vi.fn((callback) => {
        position = callback
        return 42
      }),
      clearWatch,
    },
  })
  fetchMock = vi.fn(async (url, options) => {
    if (String(url).endsWith('/points')) {
      pointsPayloads.push(JSON.parse(options.body))
      if (offline) throw new Error('Offline')
      return { ok: true, status: 200, json: async () => ({ autoStopped }) }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        session: { id: 'walk', started_at: startedAt },
        lastPoint,
        walkingAutoStop: enabled,
      }),
    }
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
async function tracker() {
  const hook = renderHook(() => useCanvassTracker())
  await act(async () => {})
  expect(navigator.geolocation.watchPosition).toHaveBeenCalled()
  return hook
}
describe('walking automatic stop', () => {
  it('uploads immediately, excludes the driving fix, exits tracking and clears the GPS watch', async () => {
    const { result } = await tracker()
    fix(0, 0)
    fix(20, 20)
    fix(300, 30)
    await waitFor(() => expect(result.current.isTracking).toBe(false))
    expect(result.current.pointCount).toBe(2)
    expect(result.current.distanceM).toBeCloseTo(20, 0)
    expect(pointsPayloads).toHaveLength(1)
    expect(clearWatch).toHaveBeenCalledWith(42)
    expect(result.current.autoStopMessage).toContain('Automatically stopped')
    expect(localStorage.getItem('canvass-point-stash')).toBeNull()
    fix(1000, 40)
    expect(pointsPayloads).toHaveLength(1)
  })
  it('detects frequent small driving movements using a sustained baseline', async () => {
    const { result } = await tracker()
    fix(0, 0)
    fix(50, 5)
    fix(100, 10)
    fix(150, 15)
    fix(200, 20)
    await waitFor(() => expect(result.current.isTracking).toBe(false))
    expect(result.current.distanceM).toBeLessThan(200)
  })
  it('does not trigger for the e-bike policy, noisy GPS or old timestamps', async () => {
    enabled = false
    const { result } = await tracker()
    fix(0, 0)
    fix(300, 30)
    fix(800, 31, 100)
    fix(700, 25)
    fix(1000, 90)
    expect(result.current.isTracking).toBe(true)
    expect(result.current.pointCount).toBe(3)
    expect(pointsPayloads).toHaveLength(0)
  })
  it('keeps the cutoff queued offline and stops when its retry succeeds', async () => {
    vi.useFakeTimers()
    const { result } = await tracker()
    offline = true
    fix(0, 0)
    fix(20, 20)
    fix(300, 30)
    await act(async () => {})
    expect(result.current.error).toContain('connection returns')
    expect(
      JSON.parse(localStorage.getItem('canvass-point-stash')!).points,
    ).toHaveLength(3)
    fix(1000, 50)
    expect(result.current.pointCount).toBe(2)
    offline = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(result.current.isTracking).toBe(false)
    expect(pointsPayloads).toHaveLength(2)
  })
  it('keeps a pending cutoff intact when Stop is pressed offline', async () => {
    const { result } = await tracker()
    offline = true
    fix(0, 0)
    fix(300, 30)
    await act(async () => {})
    await act(async () => {
      await result.current.stop()
    })
    expect(localStorage.getItem('canvass-point-stash')).not.toBeNull()
    expect(
      fetchMock.mock.calls.filter(
        ([, opts]) => opts?.body && JSON.parse(opts.body).action === 'stop',
      ),
    ).toHaveLength(0)
    expect(result.current.isTracking).toBe(true)
  })
  it('restores an offline pending cutoff and freezes new recording after reload', async () => {
    offline = true
    localStorage.setItem(
      'canvass-point-stash',
      JSON.stringify({
        sessionId: 'walk',
        autoStopPending: true,
        points: [
          {
            lat: 39.2,
            lng: -104.87,
            accuracyM: 5,
            speedMps: null,
            recordedAt: startedAt,
          },
        ],
      }),
    )
    const { result } = await tracker()
    fix(30000, 30)
    expect(result.current.pointCount).toBe(0)
    expect(result.current.error).toContain('connection returns')
    expect(
      JSON.parse(localStorage.getItem('canvass-point-stash')!).autoStopPending,
    ).toBe(true)
  })
  it('does not let an earlier in-flight upload unfreeze a queued cutoff', async () => {
    vi.useFakeTimers()
    const { result } = await tracker()
    let resolveFirst!: (value: any) => void
    let resolveCutoff!: (value: any) => void
    const original = fetchMock.getMockImplementation()!
    let uploads = 0
    fetchMock.mockImplementation((url, opts) => {
      if (String(url).endsWith('/points')) {
        uploads++
        return new Promise((resolve) => {
          if (uploads === 1) resolveFirst = resolve
          else resolveCutoff = resolve
        })
      }
      return original(url, opts)
    })
    fix(0, 0)
    fix(20, 20)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    fix(300, 30)
    await act(async () => {
      resolveFirst({ ok: true, json: async () => ({ autoStopped: false }) })
    })
    fix(1000, 50)
    expect(result.current.pointCount).toBe(2)
    await act(async () => {
      resolveCutoff({ ok: true, json: async () => ({ autoStopped: true }) })
    })
    expect(result.current.isTracking).toBe(false)
  })
  it('exits a permanently closed session instead of leaving a pending cutoff stuck', async () => {
    const { result } = await tracker()
    fetchMock.mockResolvedValue({ ok: false, status: 409 })
    fix(0, 0)
    fix(300, 30)
    await waitFor(() => expect(result.current.isTracking).toBe(false))
    expect(result.current.error).toContain('no longer open')
    expect(clearWatch).toHaveBeenCalledWith(42)
  })
  it('uses the saved previous fix after a reload, preventing a huge new connection', async () => {
    lastPoint = { lat: 39, lng: -104.87, accuracy_m: 5, recorded_at: startedAt }
    const { result } = await tracker()
    fix(15000, 72000)
    await waitFor(() => expect(result.current.isTracking).toBe(false))
    expect(result.current.distanceM).toBe(0)
    expect(result.current.pointCount).toBe(0)
  })
  it('validates a recovered offline cutoff before restarting the GPS watch', async () => {
    localStorage.setItem(
      'canvass-point-stash',
      JSON.stringify({
        sessionId: 'walk',
        points: [
          {
            lat: 39.2,
            lng: -104.87,
            accuracyM: 5,
            speedMps: null,
            recordedAt: startedAt,
          },
        ],
      }),
    )
    const { result } = renderHook(() => useCanvassTracker())
    await waitFor(() =>
      expect(result.current.autoStopMessage).toContain('Automatically stopped'),
    )
    expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled()
    expect(result.current.isTracking).toBe(false)
  })
})
