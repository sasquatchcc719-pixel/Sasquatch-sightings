import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VehicleHelpPage from './page'

vi.mock('@/lib/auth', () => ({
  requireAnyRole: vi.fn().mockResolvedValue({
    role: 'owner',
    staff: { display_name: 'Charles' },
  }),
}))

afterEach(cleanup)

describe('David’s vehicle help viewed from Charles’s account', () => {
  it('identifies David as the caller and Charles Sewell as the account holder in every tab', async () => {
    render(await VehicleHelpPage())
    for (const tab of ['Roadside help', 'Need a tow', 'Repair shop']) {
      fireEvent.click(screen.getByRole('button', { name: tab }))
      expect(screen.getByText(/Introduce yourself:/)).toHaveTextContent(
        'I’m David. I work for Charles Sewell',
      )
      expect(screen.getByText(/Introduce yourself:/)).toHaveTextContent(
        'The account may be under Charles Sewell.',
      )
      const message = screen.queryByRole('textbox', {
        name: 'Message to share or read by phone',
      }) as HTMLTextAreaElement | null
      expect(screen.getByText(/Introduce yourself:/)).toHaveTextContent(
        'Please bill and issue all paperwork to Sasquatch Carpet Cleaning. This is a business expense.',
      )
      if (message) {
        expect(message.value).toContain('I’m David.')
        expect(message.value).toContain(
          'The account may be under Charles Sewell.',
        )
        expect(message.value).not.toContain('I’m Charles')
        expect(message.value).toContain(
          'Please bill and issue all paperwork to Sasquatch Carpet Cleaning. This is a business expense.',
        )
      }
    }
  })

  it('gives the mechanic driving directions without pickup or dispatch controls, even after GPS use', async () => {
    render(await VehicleHelpPage())
    fireEvent.click(
      screen.getByRole('button', { name: 'Enter location manually' }),
    )
    fireEvent.change(
      screen.getByLabelText('Map pin, GPS coordinates, or pickup address'),
      { target: { value: 'I-25 northbound, exit 153' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Repair shop' }))
    expect(
      screen.queryAllByRole('button', {
        name: /GPS location|Share location message|Enter location manually/,
      }),
    ).toHaveLength(0)
    expect(
      screen.queryByRole('textbox', {
        name: 'Message to share or read by phone',
      }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Before you hang up/)).not.toBeInTheDocument()
    const directions = new URL(
      screen
        .getByRole('link', { name: 'Navigate in Apple Maps' })
        .getAttribute('href')!,
    )
    expect(directions.hostname).toBe('maps.apple.com')
    expect(directions.searchParams.get('daddr')).toBe(
      '2522 E Platte Ave, Colorado Springs, CO 80909',
    )
    expect(directions.searchParams.get('dirflg')).toBe('d')
    expect(directions.searchParams.has('saddr')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Need a tow' }))
    expect(
      screen.getByRole('button', { name: 'Get my GPS location' }),
    ).toBeVisible()
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Message to share or read by phone',
        }) as HTMLTextAreaElement
      ).value,
    ).toContain('I-25 northbound, exit 153')
  })
})
