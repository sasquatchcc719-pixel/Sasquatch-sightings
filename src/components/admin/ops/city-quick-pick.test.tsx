import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CityQuickPick } from './city-quick-pick'
import { SERVICE_CITIES } from '@/lib/ops/service-cities'

describe('CityQuickPick', () => {
  it('shows a button for every town we work in', () => {
    render(<CityQuickPick value="" onPick={() => {}} />)
    for (const entry of SERVICE_CITIES) {
      expect(screen.getByRole('button', { name: entry.city })).toBeTruthy()
    }
  })

  it('marks the button matching the current city as pressed', () => {
    render(<CityQuickPick value="monument" onPick={() => {}} />)
    expect(
      screen.getByRole('button', { name: 'Monument' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen
        .getByRole('button', { name: 'Palmer Lake' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('passes city, state and zip for single-zip towns', async () => {
    const onPick = vi.fn()
    render(<CityQuickPick value="" onPick={onPick} />)

    await userEvent.click(screen.getByRole('button', { name: 'Monument' }))
    expect(onPick).toHaveBeenCalledWith({
      city: 'Monument',
      state: 'CO',
      zip: '80132',
    })

    await userEvent.click(screen.getByRole('button', { name: 'Palmer Lake' }))
    expect(onPick).toHaveBeenLastCalledWith({
      city: 'Palmer Lake',
      state: 'CO',
      zip: '80133',
    })

    await userEvent.click(screen.getByRole('button', { name: 'Larkspur' }))
    expect(onPick).toHaveBeenLastCalledWith({
      city: 'Larkspur',
      state: 'CO',
      zip: '80118',
    })
  })

  it('omits zip for multi-zip towns so a wrong zip is never filled in', async () => {
    const onPick = vi.fn()
    render(<CityQuickPick value="" onPick={onPick} />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Colorado Springs' }),
    )
    expect(onPick).toHaveBeenLastCalledWith({
      city: 'Colorado Springs',
      state: 'CO',
    })

    await userEvent.click(screen.getByRole('button', { name: 'Castle Rock' }))
    expect(onPick).toHaveBeenLastCalledWith({ city: 'Castle Rock', state: 'CO' })
  })
})
