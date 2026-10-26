import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import BookPage from './page'

const response = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  })
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 6, 12))
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/services'))
      return response({
        services: [
          {
            id: 'test-service',
            name: 'Regular room',
            category: 'Carpet Cleaning',
            base_price: 300,
            pricing_unit: 'fixed',
          },
        ],
      })
    if (url.includes('/lead-sources'))
      return response({
        options: [
          {
            key: 'nextdoor',
            value: 'nextdoor',
            customer_label: 'Nextdoor',
            requires_detail: false,
          },
        ],
      })
    if (url.includes('start_date='))
      return response({
        days: [{ date: '2026-09-08', slots: 1, is_available: true }],
      })
    if (url.includes('/availability'))
      return response({
        slots: [{ start_time: '10:00', end_time: '12:00', label: '10:00 AM' }],
      })
    if (url.includes('/promo-preview'))
      return response({ discount_amount: 35, total: 265, applied: true })
    throw new Error('Unexpected synthetic request: ' + url)
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
it('shows the public code saving and $265 before confirmation, without booking', async () => {
  render(<BookPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Add' }))
  fireEvent.click(screen.getByRole('button', { name: 'Select Date →' }))
  const day = await screen.findByRole('button', { name: '8' })
  await waitFor(() => expect(day).toBeEnabled())
  fireEvent.click(day)
  fireEvent.click(await screen.findByRole('button', { name: '10:00 AM' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue →' }))
  for (const [placeholder, value] of [
    ['John', 'Preview'],
    ['Smith', 'Only'],
    ['john@example.com', 'preview@example.com'],
    ['(719) 555-0123', '7195550123'],
    ['Street address *', '123 Example Street'],
    ['City *', 'Monument'],
    ['ZIP *', '80132'],
  ])
    fireEvent.change(screen.getByPlaceholderText(placeholder), {
      target: { value },
    })
  fireEvent.change(screen.getAllByRole('combobox')[0], {
    target: { value: 'nextdoor' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Review →' }))
  fireEvent.change(screen.getByPlaceholderText('ENTER CODE'), {
    target: { value: 'NEXTDOOR35' },
  })
  expect(await screen.findByText('$265.00')).toBeInTheDocument()
  expect(screen.getByText('−$35.00')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirm Booking' })).toBeEnabled()
  expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/book')).toBe(
    false,
  )
  const query = vi
    .mocked(fetch)
    .mock.calls.find(([url]) => String(url).includes('/promo-preview'))![0]
  expect(String(query)).toContain('service_subtotal=300')
})
