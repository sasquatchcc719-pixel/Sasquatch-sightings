import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NfcBookingWidget } from './NfcBookingWidget'
import styles from './booking-forest.module.css'

const room = {
  id: 'room',
  name: 'Regular room',
  base_price: 90,
  category: 'Carpet Cleaning',
  description: 'A living room.',
  pricing_unit: 'fixed',
  duration_minutes: 60,
}
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const track = vi.fn()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 6, 12))
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/api/public/services'))
      return response({ services: [room], checkoutUpsells: [] })
    if (url.includes('start_date='))
      return response({ days: [{ date: '2026-09-08', slots: 1 }] })
    if (url.includes('/api/public/availability'))
      return response({
        slots: [{ start_time: '10:00', end_time: '12:00', label: '10:00 AM' }],
      })
    if (url.includes('/api/public/promo-preview'))
      return response({ discount_amount: 20, total: 160 })
    if (url === '/api/book')
      return response({
        confirmation_number: 'TEST-ONLY',
        total: 160,
        discount_applied: 20,
        appointment_id: 'test',
      })
    throw new Error(`Unexpected test request: ${url}`)
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  track.mockClear()
})

async function reachDetails() {
  render(
    <NfcBookingWidget
      appearance="forest"
      couponCode="SCC20"
      cardId="existing-card"
      onTrackClick={track}
    />,
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Standard Carpet Cleaning' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Add Regular room' }))
  expect(screen.getAllByRole('button', { name: 'Next →' })[0]).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Add one Regular room' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Next →' })[0])
  const day = await screen.findByRole('button', {
    name: 'Tuesday, September 8 — Available',
  })
  fireEvent.click(day)
  expect(day).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(await screen.findByRole('button', { name: '10:00 AM' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue →' }))
}

function fillDetails() {
  for (const [label, value] of [
    ['First Name *', 'Preview'],
    ['Last Name *', 'Only'],
    ['Email *', 'preview@example.com'],
    ['Phone *', '7195550123'],
    ['Street address', '123 Example Street'],
    ['City', 'Monument'],
    ['ZIP code', '80132'],
  ])
    fireEvent.change(screen.getByRole('textbox', { name: label }), {
      target: { value },
    })
}

describe('forest estimator', () => {
  it('preserves the minimum, all steps, coupon, attribution, payload, and confirmation', async () => {
    await reachDetails()
    fillDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Review →' }))
    expect(await screen.findByText('−$20.00')).toBeInTheDocument()
    expect(screen.getByText('$160.00')).toBeInTheDocument()
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/book'),
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Booking' }))
    expect(await screen.findByText("You're booked!")).toBeInTheDocument()
    const booking = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => url === '/api/book')!
    expect(JSON.parse(String(booking[1]?.body))).toMatchObject({
      customer: { first_name: 'Preview', phone: '7195550123' },
      appointment: {
        appointment_date: '2026-09-08',
        start_time: '10:00',
        lead_source_detail: 'existing-card',
      },
      line_items: [
        { service_catalog_item_id: 'room', quantity: 2, unit_price: 90 },
      ],
      promo_code: 'SCC20',
    })
    expect(track).toHaveBeenCalledWith('booking_widget_submit')
  })

  it('keeps validation and a failed booking recoverable', async () => {
    await reachDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Review →' }))
    expect(screen.getByText('Please enter your full name.')).toBeInTheDocument()
    fillDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Review →' }))
    await screen.findByText('$160.00')
    vi.mocked(fetch).mockResolvedValueOnce(
      response(
        { error: 'That time was just booked. Please select another time.' },
        409,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Booking' }))
    expect(
      await screen.findByText(/That time was just booked/),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Confirm Booking' }),
      ).toBeEnabled(),
    )
    expect(track).not.toHaveBeenCalled()
  })

  it('does not apply the forest skin to partner and rebook entry points', async () => {
    const { container } = render(
      <NfcBookingWidget
        couponCode="SCC20"
        cardId={null}
        onTrackClick={track}
      />,
    )
    await screen.findByRole('button', { name: 'Standard Carpet Cleaning' })
    expect(container.querySelector(`.${styles.forest}`)).toBeNull()
  })
})
