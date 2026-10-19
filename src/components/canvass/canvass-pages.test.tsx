import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/canvass/CanvassCoverageMap', () => ({
  CanvassCoverageMap: ({ days }: { days: number }) => (
    <div data-testid="coverage-days">{days}</div>
  ),
}))
vi.mock('@/hooks/useCanvassTracker', () => ({
  useCanvassTracker: () => ({ isTracking: false }),
}))

import AdminCanvassPage from '@/app/admin/canvass/page'
import CanvassPage from '@/app/field/canvass/page'

afterEach(cleanup)

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
