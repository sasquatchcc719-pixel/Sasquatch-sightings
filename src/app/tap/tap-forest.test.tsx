import { createElement } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
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

it('plays the original muted inline forest without showing a motion control', () => {
  const { container } = render(<TapForest />)
  const video = container.querySelector('video')!
  expect(video).toHaveAttribute('src', '/forest-loop-2.mp4')
  expect(video.muted).toBe(true)
  expect(video).toHaveAttribute('playsinline')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('does not load the video when reduced motion is requested', () => {
  reduced = true
  const { container } = render(<TapForest />)
  expect(container.querySelector('video')).toBeNull()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  reduced = false
  act(() => change())
  expect(container.querySelector('video')).not.toBeNull()
})
