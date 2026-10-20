import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScheduleDispatchPanel } from './schedule-dispatch-panel'

// Native dialog focus and animation are additionally exercised in a real browser.
vi.mock('next/dynamic', () => ({
  default: () =>
    function MapFixture() {
      return <div>Loaded map</div>
    },
}))

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('calendar dispatch panel', () => {
  it('loads maps only when opened and removes them after closing', async () => {
    render(<ScheduleDispatchPanel day="2026-10-19" />)
    expect(screen.queryByText('Loaded map')).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'Map' })
    fireEvent.click(trigger)
    expect(
      await screen.findByRole('dialog', { name: 'Live dispatch map' }),
    ).toBeVisible()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Loaded map')).toBeVisible()
    const content = screen
      .getByRole('dialog')
      .querySelector<HTMLElement>('[data-dispatch-scroll]')!
    content.scrollTop = 400
    fireEvent.click(screen.getByRole('button', { name: 'Close dispatch map' }))
    await waitFor(() =>
      expect(screen.queryByText('Loaded map')).not.toBeInTheDocument(),
    )
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(content.scrollTop).toBe(0)
  })

  it('opens one dispatch map and handles native Escape without navigating away', async () => {
    render(<ScheduleDispatchPanel day="2026-10-19" />)
    fireEvent.click(screen.getByRole('button', { name: 'Map' }))
    const panel = await screen.findByRole('dialog')
    expect(
      screen.queryByRole('button', { name: 'Vehicles' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Technicians' }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByText('Loaded map')).toHaveLength(1)
    fireEvent(panel, new Event('cancel', { bubbles: false, cancelable: true }))
    await waitFor(() => expect(panel).not.toHaveAttribute('open'))
    expect(screen.queryByText('Loaded map')).not.toBeInTheDocument()
  })
})
