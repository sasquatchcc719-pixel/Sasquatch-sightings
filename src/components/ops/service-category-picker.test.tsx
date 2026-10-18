import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ServiceCategoryPicker } from './service-category-picker'

const categories = ['Stairs', 'Other', 'Carpet Cleaning']
const services = [
  { name: 'Stair Carpet Cleaning', category: 'Stairs' },
  { name: 'Specialty service', category: 'Other' },
  { name: 'Custom service', category: 'Other' },
  { name: 'Discount', slug: 'discount', category: 'Other' },
  { name: 'Room Carpet Cleaning', category: 'Carpet Cleaning' },
]

describe('ServiceCategoryPicker', () => {
  it('shows service counts and changes category without submitting a form', () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn((event) => event.preventDefault())
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <ServiceCategoryPicker
          categories={categories}
          services={services}
          value="Stairs"
          onChange={onChange}
        />
      </form>,
    )
    const stairs = screen.getByRole('button', { name: 'Stairs, 1 service' })
    const other = screen.getByRole('button', { name: 'Other, 2 services' })
    expect(stairs).toHaveAttribute('aria-pressed', 'true')
    expect(other).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(other)
    expect(onChange).toHaveBeenCalledWith('Other')
    expect(onSubmit).not.toHaveBeenCalled()

    rerender(
      <ServiceCategoryPicker
        categories={categories}
        services={services}
        value="Other"
        onChange={onChange}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Other, 2 services' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('uses approved photos and keeps an icon when no matching photo exists', () => {
    render(
      <ServiceCategoryPicker
        categories={categories}
        services={services}
        value="Stairs"
        onChange={vi.fn()}
      />,
    )
    const stairs = screen.getByRole('button', { name: 'Stairs, 1 service' })
    const other = screen.getByRole('button', { name: 'Other, 2 services' })
    expect(within(stairs).getByRole('presentation')).toHaveAttribute(
      'src',
      expect.stringContaining('stair-carpet-cleaning'),
    )
    expect(within(other).queryByRole('presentation')).not.toBeInTheDocument()
    const residential = screen.getByRole('button', {
      name: 'Carpet Cleaning, 1 service',
    })
    expect(residential.innerHTML).not.toContain('commercial-carpet-cleaning')
  })
})
