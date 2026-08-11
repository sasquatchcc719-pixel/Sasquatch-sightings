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
      zips: expect.arrayContaining(['80921', '80908']),
    })

    await userEvent.click(screen.getByRole('button', { name: 'Castle Rock' }))
    expect(onPick).toHaveBeenLastCalledWith({
      city: 'Castle Rock',
      state: 'CO',
      zips: expect.arrayContaining(['80104', '80109', '80108']),
    })
  })

  it('offers zip buttons once a multi-zip town is picked', async () => {
    const onPickZip = vi.fn()
    render(
      <CityQuickPick
        value="Colorado Springs"
        onPick={() => {}}
        zipValue=""
        onPickZip={onPickZip}
      />,
    )

    // Most-worked zip first, so the common job is the first button.
    expect(screen.getByRole('button', { name: '80921' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '80908' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '80908' }))
    expect(onPickZip).toHaveBeenCalledWith('80908')
  })

  it('shows no zip buttons for single-zip towns — the zip is already filled', () => {
    render(
      <CityQuickPick
        value="Monument"
        onPick={() => {}}
        zipValue="80132"
        onPickZip={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: '80132' })).toBeNull()
  })

  it('marks the zip already on the job as pressed', () => {
    render(
      <CityQuickPick
        value="Castle Rock"
        onPick={() => {}}
        zipValue="80109"
        onPickZip={() => {}}
      />,
    )
    expect(
      screen.getByRole('button', { name: '80109' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByRole('button', { name: '80104' }).getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('hides the zip row entirely when the caller does not manage a zip field', () => {
    render(<CityQuickPick value="Colorado Springs" onPick={() => {}} />)
    expect(screen.queryByRole('button', { name: '80921' })).toBeNull()
  })
})
