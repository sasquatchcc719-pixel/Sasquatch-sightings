import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvassPocketMode } from './CanvassPocketMode'

function sentinel() {
  const target = new EventTarget()
  return Object.assign(target, {
    released: false,
    release: vi.fn(async () => {
      target.dispatchEvent(new Event('release'))
    }),
  })
}

const props = {
  duration: '12:34',
  distance: '0.75 mi',
  accuracy: 8,
  error: null,
}

describe('pocket mode', () => {
  let lock: ReturnType<typeof sentinel>
  let request: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.useFakeTimers()
    lock = sentinel()
    request = vi.fn().mockResolvedValue(lock)
    vi.stubGlobal('navigator', { wakeLock: { request } })
    vi.stubGlobal('PointerEvent', MouseEvent)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('requests screen wake and reports the actual GPS and screen status', async () => {
    render(<CanvassPocketMode {...props} onExit={vi.fn()} />)
    await act(async () => {})
    expect(request).toHaveBeenCalledWith('screen')
    expect(screen.getByText('Keep-awake enabled')).toBeTruthy()
    expect(screen.getByText('GPS accuracy ±8m')).toBeTruthy()
    expect(screen.getByText(/phone unlocked/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull()
  })

  it('ignores ordinary taps and requires a continuous two-second hold', async () => {
    const exit = vi.fn()
    render(<CanvassPocketMode {...props} onExit={exit} />)
    await act(async () => {})
    const button = screen.getByRole('button', { name: /hold 2 seconds/i })
    fireEvent.click(button)
    expect(exit).not.toHaveBeenCalled()
    fireEvent.pointerDown(button, { button: 0 })
    act(() => vi.advanceTimersByTime(1999))
    expect(exit).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it.each(['pointerUp', 'pointerCancel', 'pointerLeave', 'blur'] as const)(
    'cancels a partial hold on %s',
    async (event) => {
      const exit = vi.fn()
      render(<CanvassPocketMode {...props} onExit={exit} />)
      await act(async () => {})
      const button = screen.getByRole('button', { name: /hold 2 seconds/i })
      fireEvent.pointerDown(button, { button: 0 })
      act(() => vi.advanceTimersByTime(1500))
      fireEvent[event](button)
      act(() => vi.advanceTimersByTime(2000))
      expect(exit).not.toHaveBeenCalled()
    },
  )

  it('supports a keyboard hold and cancels early key release', async () => {
    const exit = vi.fn()
    render(<CanvassPocketMode {...props} onExit={exit} />)
    await act(async () => {})
    const button = screen.getByRole('button', { name: /hold 2 seconds/i })
    fireEvent.keyDown(button, { key: 'Enter' })
    act(() => vi.advanceTimersByTime(1000))
    fireEvent.keyUp(button, { key: 'Enter' })
    act(() => vi.advanceTimersByTime(2000))
    expect(exit).not.toHaveBeenCalled()
    fireEvent.keyDown(button, { key: ' ' })
    act(() => vi.advanceTimersByTime(2000))
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('warns when wake is rejected and surfaces tracking errors instead of claiming GPS is ready', async () => {
    request.mockRejectedValue(new Error('Low battery'))
    render(
      <CanvassPocketMode
        {...props}
        error="Location permission denied"
        onExit={vi.fn()}
      />,
    )
    await act(async () => {})
    expect(screen.getByText(/Keep-awake unavailable/)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe(
      'Location permission denied',
    )
    expect(screen.queryByText(/GPS accuracy/)).toBeNull()
  })

  it('warns if wake is unsupported', async () => {
    vi.stubGlobal('navigator', {})
    render(<CanvassPocketMode {...props} onExit={vi.fn()} />)
    await act(async () => {})
    expect(screen.getByText(/Keep-awake unavailable/)).toBeTruthy()
  })

  it('reacquires a released lock on return and cancels holds while hidden', async () => {
    const exit = vi.fn()
    render(<CanvassPocketMode {...props} onExit={exit} />)
    await act(async () => {})
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0 })
    lock.released = true
    act(() => lock.dispatchEvent(new Event('release')))
    expect(screen.getByText(/Keep-awake unavailable/)).toBeTruthy()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    fireEvent(document, new Event('visibilitychange'))
    act(() => vi.advanceTimersByTime(2000))
    expect(exit).not.toHaveBeenCalled()
    request.mockResolvedValue(sentinel())
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    await act(async () => {
      fireEvent(document, new Event('visibilitychange'))
    })
    expect(request).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Keep-awake enabled')).toBeTruthy()
  })

  it('releases its lock and clears a pending hold on unmount', async () => {
    const exit = vi.fn()
    const { unmount } = render(<CanvassPocketMode {...props} onExit={exit} />)
    await act(async () => {})
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0 })
    unmount()
    act(() => vi.advanceTimersByTime(2000))
    expect(lock.release).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
  })

  it('releases a lock that arrives after the screen was closed', async () => {
    let resolve!: (value: ReturnType<typeof sentinel>) => void
    request.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const { unmount } = render(
      <CanvassPocketMode {...props} onExit={vi.fn()} />,
    )
    unmount()
    await act(async () => {
      resolve(lock)
    })
    expect(lock.release).toHaveBeenCalledTimes(1)
  })
})
