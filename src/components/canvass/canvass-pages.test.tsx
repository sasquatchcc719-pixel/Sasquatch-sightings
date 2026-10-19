import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tracker = vi.hoisted(() => ({
  isTracking: false,
  sessionId: null as string | null,
  elapsedMs: 0,
  distanceM: 0,
  accuracy: null,
  error: null,
  autoStopMessage: null as string | null,
  start: vi.fn(),
  stop: vi.fn(),
}))
const walks = vi.hoisted(() => [
  {
    id: 'long-walk',
    user_id: 'david',
    user_name: 'David',
    color: '#22c55e',
    started_at: '2026-09-01T21:39:56Z',
    ended_at: '2026-09-02T18:13:00Z',
    status: 'completed',
    has_route: true,
    point_count: 260,
    distance_m: 18067,
    gps_distance_m: 18067,
    coverage_distance_m: 1919,
    gap_distance_m: 16148,
    gap_count: 2,
  },
])

vi.mock('@/components/canvass/CanvassCoverageMap', () => ({
  CanvassCoverageMap: ({
    days,
    onSessions,
    focusSessionId,
    onClearFocus,
  }: {
    days: number
    onSessions?: (rows: typeof walks) => void
    focusSessionId?: string | null
    onClearFocus?: () => void
  }) => (
    <>
      <div data-testid="coverage-days">{days}</div>
      <div data-testid="focused-track">{focusSessionId}</div>
      <button type="button" onClick={() => onSessions?.(walks)}>
        Load test walks
      </button>
      {focusSessionId ? (
        <button type="button" onClick={onClearFocus}>
          Clear track
        </button>
      ) : null}
    </>
  ),
}))
vi.mock('@/hooks/useCanvassTracker', () => ({
  useCanvassTracker: () => tracker,
}))

import AdminCanvassPage from '@/app/admin/canvass/page'
import CanvassPage from '@/app/field/canvass/page'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
beforeEach(() => {
  vi.clearAllMocks()
  tracker.isTracking = false
  tracker.sessionId = null
  tracker.autoStopMessage = null
  tracker.start.mockReset().mockResolvedValue(undefined)
})

describe('canvassing defaults', () => {
  it.each([
    ['admin', AdminCanvassPage],
    ['field', CanvassPage],
  ] as const)('%s opens the complete shared history', (_name, Page) => {
    render(<Page />)
    expect(screen.getByTestId('coverage-days').textContent).toBe('0')
    expect(
      screen
        .getByRole('button', { name: 'All time' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(screen.getByText(/not a count of doors or hangers/)).toBeTruthy()
  })
  it.each([
    ['admin', AdminCanvassPage],
    ['field', CanvassPage],
  ] as const)(
    '%s selects a long track and brings the map into view',
    (_name, Page) => {
      const scroll = vi.fn()
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: scroll,
      })
      render(<Page />)
      fireEvent.click(screen.getByRole('button', { name: 'Load test walks' }))
      fireEvent.click(screen.getByRole('button', { name: /11.23 mi GPS/ }))
      expect(screen.getByTestId('focused-track').textContent).toBe('long-walk')
      expect(scroll).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
      })
      fireEvent.click(screen.getByRole('button', { name: /11.23 mi GPS/ }))
      expect(scroll).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId('focused-track').textContent).toBe('long-walk')
      fireEvent.click(screen.getByRole('button', { name: 'Clear track' }))
      expect(screen.getByTestId('focused-track').textContent).toBe('')
      fireEvent.click(screen.getByRole('button', { name: /11.23 mi GPS/ }))
      fireEvent.click(screen.getByRole('button', { name: /30 days/ }))
      expect(screen.getByTestId('focused-track').textContent).toBe('')
    },
  )
})

describe('automatic pocket mode', () => {
  it('leaves pocket mode and explains an automatic stop', () => {
    tracker.isTracking = true
    tracker.sessionId = 'walk'
    const { rerender } = render(<CanvassPage />)
    expect(screen.getByRole('heading', { name: 'Pocket mode' })).toBeTruthy()
    tracker.isTracking = false
    tracker.sessionId = null
    tracker.autoStopMessage =
      'Automatically stopped: movement exceeded walking limits.'
    rerender(<CanvassPage />)
    expect(screen.queryByRole('heading', { name: 'Pocket mode' })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain(
      'Automatically stopped',
    )
    expect(
      screen.getByRole('button', { name: 'Start Canvassing' }),
    ).toBeTruthy()
  })
  it('opens after Start creates a walk, reveals controls without stopping, and can be reopened', async () => {
    vi.useFakeTimers()
    tracker.start.mockImplementation(async () => {
      tracker.isTracking = true
      tracker.sessionId = 'walk'
    })
    const { rerender } = render(<CanvassPage />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start Canvassing' }))
    })
    rerender(<CanvassPage />)
    expect(screen.getByRole('heading', { name: 'Pocket mode' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop Canvassing' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByRole('button', { name: 'Stop Canvassing' })).toBeTruthy()
    expect(tracker.stop).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Return to pocket mode' }),
    )
    expect(screen.getByRole('heading', { name: 'Pocket mode' })).toBeTruthy()
  })

  it('opens for a resumed walk and does not open when a start fails', async () => {
    tracker.start.mockResolvedValue(undefined)
    const { rerender } = render(<CanvassPage />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start Canvassing' }))
    })
    expect(screen.queryByRole('heading', { name: 'Pocket mode' })).toBeNull()
    tracker.isTracking = true
    tracker.sessionId = 'resumed'
    rerender(<CanvassPage />)
    expect(screen.getByRole('heading', { name: 'Pocket mode' })).toBeTruthy()
  })
})
