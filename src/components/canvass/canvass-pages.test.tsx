import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tracker = vi.hoisted(() => ({
  isTracking: false,
  sessionId: null as string | null,
  elapsedMs: 0,
  distanceM: 0,
  accuracy: null,
  error: null,
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('@/components/canvass/CanvassCoverageMap', () => ({
  CanvassCoverageMap: ({ days }: { days: number }) => (
    <div data-testid="coverage-days">{days}</div>
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
})

describe('automatic pocket mode', () => {
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
