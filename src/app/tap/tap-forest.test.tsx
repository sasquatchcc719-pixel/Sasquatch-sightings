import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TapForest } from './tap-forest'

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    createElement('img', { src, alt }),
}))
let change: () => void
let reduced = false
beforeEach(() => {
  reduced = false
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return reduced
      },
      addEventListener: (_: string, fn: () => void) => {
        change = fn
      },
      removeEventListener: vi.fn(),
    })),
  )
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('plays the original muted inline loop and provides an immediate pause', () => {
  const { container } = render(<TapForest />)
  const video = container.querySelector('video')!
  expect(video).toHaveAttribute('src', '/forest-loop-2.mp4')
  expect(video.muted).toBe(true)
  expect(video).toHaveAttribute('playsinline')
  fireEvent.click(
    screen.getByRole('button', { name: 'Pause background animation' }),
  )
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
  expect(
    screen.getByRole('button', { name: 'Play background animation' }),
  ).toBeInTheDocument()
})

it('does not load the video for reduced motion until explicitly requested', () => {
  reduced = true
  const { container } = render(<TapForest />)
  expect(container.querySelector('video')).toBeNull()
  fireEvent.click(
    screen.getByRole('button', { name: 'Play background animation' }),
  )
  expect(container.querySelector('video')).not.toBeNull()
  act(() => change())
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
})
