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
  it('offers the 370 checks without dispatch controls and connects to repair and schedule help', async () => {
    render(await VehicleHelpPage())
    fireEvent.click(screen.getByRole('button', { name: 'Machine stopped' }))
    expect(
      screen.getByRole('heading', {
        name: 'Sapphire Scientific 370 stopped running',
      }),
    ).toBeVisible()
    expect(
      screen.getByRole('heading', {
        name: '1. Check the dump tank first',
      }),
    ).toBeVisible()
    expect(
      screen.getByRole('heading', {
        name: '3. Replace the filter with vice grips',
      }),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'NAPA part listing' }),
    ).toHaveAttribute('href', 'https://www.napaonline.com/en/p/FIL3054')
    expect(screen.getByRole('link', { name: /Call NAPA/ })).toHaveAttribute(
      'href',
      'tel:+17195741650',
    )
    expect(
      screen.getByRole('img', { name: /fuel filter box labeled 3054/ }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Get my GPS location' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', {
        name: 'Message to share or read by phone',
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: 'Vehicle' }),
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Call Matt / repair shop details' }),
    )
    expect(screen.getByRole('link', { name: /Call.*Matt/ })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Machine stopped' }))
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Switch trucks & manage the schedule',
      }),
    )
    expect(
      screen.getByRole('link', { name: 'Call 719-367-4806' }),
    ).toBeVisible()
  })

  it('separates emergency schedule coordination from GPS and vendor dispatch', async () => {
    render(await VehicleHelpPage())
    fireEvent.click(screen.getByRole('button', { name: 'Schedule changes' }))
    expect(
      screen.getByRole('heading', { name: 'Emergency schedule changes' }),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Call 719-367-4806' }),
    ).toHaveAttribute('href', 'tel:+17193674806')
    expect(
      screen.getByText(
        /She will call that customer and arrange the reschedule/,
      ),
    ).toBeVisible()
    expect(screen.getByText(/It’s David/)).toBeVisible()
    expect(screen.getByText(/take an Uber or ask a buddy/)).toBeVisible()
    expect(
      screen.getByText(/switch into the other truck with working equipment/),
    ).toBeVisible()
    expect(
      screen.getByText(/Aim to lose only the affected appointment/),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Open today’s jobs' }),
    ).toHaveAttribute('href', '/tech')
    expect(
      screen.queryByRole('button', { name: 'Get my GPS location' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', {
        name: 'Message to share or read by phone',
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: 'Vehicle' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Need a tow' }))
    expect(screen.getByRole('link', { name: /Call.*Randy/ })).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Get my GPS location' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('link', { name: 'Call 719-367-4806' }),
    ).not.toBeInTheDocument()
  })

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
