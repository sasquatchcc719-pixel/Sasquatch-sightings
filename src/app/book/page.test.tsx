import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BookPage from './page'

const services = [
  {
    id: 'room',
    name: 'Room Carpet Cleaning',
    category: 'Carpet Cleaning',
    base_price: 60,
    description: null,
    pricing_unit: 'per_room',
  },
  {
    id: 'sofa',
    name: 'Sofa Cleaning',
    category: 'Upholstery Cleaning',
    base_price: 120,
    description: null,
    pricing_unit: 'each',
  },
]

const requests: Array<{ url: string; method: string }> = []

beforeEach(() => {
  requests.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method || 'GET' })
      return Response.json(
        url === '/api/public/services' ? { services } : { options: [] },
      )
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('public booking category cards', () => {
  it('uses approved photos and preserves the existing category display names', async () => {
    render(<BookPage />)
    const carpet = await screen.findByRole('button', {
      name: 'Standard Carpet Cleaning 1 service',
    })
    const upholstery = screen.getByRole('button', {
      name: 'Upholstery Cleaning 1 service',
    })

    expect(within(upholstery).getByRole('presentation')).toHaveAttribute(
      'src',
      expect.stringContaining('upholstery-cleaning'),
    )
    expect(within(carpet).queryByRole('presentation')).not.toBeInTheDocument()
    expect(carpet).toHaveAttribute('aria-expanded', 'true')
    expect(upholstery).toHaveAttribute('aria-expanded', 'true')
  })

  it('toggles categories independently and preserves selected quantities without booking', async () => {
    render(<BookPage />)
    const carpet = await screen.findByRole('button', {
      name: 'Standard Carpet Cleaning 1 service',
    })
    const upholstery = screen.getByRole('button', {
      name: 'Upholstery Cleaning 1 service',
    })
    const carpetSection = carpet.parentElement!
    fireEvent.click(within(carpetSection).getByRole('button', { name: 'Add' }))
    expect(
      within(carpetSection).getByRole('button', { name: 'Add one more' }),
    ).toBeInTheDocument()

    fireEvent.click(carpet)
    expect(carpet).toHaveAttribute('aria-expanded', 'false')
    expect(upholstery).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(carpetSection).queryByRole('button', { name: 'Add one more' }),
    ).not.toBeInTheDocument()

    fireEvent.click(carpet)
    expect(carpet).toHaveAttribute('aria-expanded', 'true')
    expect(within(carpetSection).getByText('1')).toBeInTheDocument()
    expect(
      within(carpetSection).getByRole('button', { name: 'Add one more' }),
    ).toBeInTheDocument()
    expect(requests.some((request) => request.method === 'POST')).toBe(false)
  })
})
