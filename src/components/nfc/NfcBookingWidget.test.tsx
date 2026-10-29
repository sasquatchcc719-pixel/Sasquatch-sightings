import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NfcBookingWidget,
  type NfcBookingWidgetProps,
} from './NfcBookingWidget'
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

async function reachDetails(props: Partial<NfcBookingWidgetProps> = {}) {
  render(
    <NfcBookingWidget
      appearance="forest"
      couponCode="SCC20"
      bookingChannel="business_card"
      cardId="existing-card"
      tapId="tap-test"
      onTrackClick={track}
      {...props}
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
        booking_channel: 'business_card',
        lead_source_key: 'business_card',
        lead_source_detail: 'existing-card',
        tap_id: 'tap-test',
      },
      line_items: [
        { service_catalog_item_id: 'room', quantity: 2, unit_price: 90 },
      ],
      promo_code: 'SCC20',
    })
    expect(track).toHaveBeenCalledWith('booking_widget_submit')
  })

  it.each([
    [{ partnerId: 'partner-location' }, 'nfc_partner'],
    [{ leadSourceKey: 'nextdoor' }, 'nextdoor'],
    [{ bookingChannel: 'website' as const }, 'nfc_partner'],
  ])(
    'preserves partner and campaign attribution for %o',
    async (props, sourceKey) => {
      await reachDetails(props)
      fillDetails()
      fireEvent.click(screen.getByRole('button', { name: 'Review →' }))
      await screen.findByText('$160.00')
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Booking' }))
      await screen.findByText("You're booked!")
      const booking = vi
        .mocked(fetch)
        .mock.calls.find(([url]) => url === '/api/book')!
      expect(JSON.parse(String(booking[1]?.body)).appointment).toMatchObject({
        lead_source_key: sourceKey,
        booking_channel: 'website',
      })
    },
  )

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

describe('NEXTDOOR35 checkout displays one saving', () => {
  async function reviewRugs(price: number) {
    const original = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).includes('/api/public/services'))
        return response({
          services: [{ ...room, base_price: price, category: 'rug cleaning' }],
          checkoutUpsells: [],
        })
      if (String(input).includes('/api/public/promo-preview'))
        return response({
          discount_amount: 35,
          total: price * 2 - 35,
          minimum_subtotal: 300,
        })
      return original(input, init)
    })
    render(<NfcBookingWidget couponCode="NEXTDOOR35" cardId={null} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Rug Cleaning' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Regular room' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Add one Regular room' }),
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Next →' })[0])
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Tuesday, September 8 — Available',
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: '10:00 AM' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue →' }))
    fillDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Review →' }))
    await screen.findByText(
      /NEXTDOOR35 and the multi-rug discount cannot combine/,
    )
  }
  it('keeps and clearly shows a larger multi-rug saving; submits no coupon', async () => {
    await reviewRugs(300)
    expect(screen.getByText('$540.00')).toBeInTheDocument()
    expect(
      screen.getByText(/The higher multi-rug discount is applied/),
    ).toBeInTheDocument()
    expect(screen.queryByText('−$35.00')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Booking' }))
    await screen.findByText("You're booked!")
    const request = vi
      .mocked(fetch)
      .mock.calls.find(([u]) => u === '/api/book')!
    const body = JSON.parse(String(request[1]?.body))
    expect(body.promo_code).toBeUndefined()
    expect(body.percentage_discount).toMatchObject({
      percent: 10,
      scope: 'rug_cleaning',
    })
  })
  it('shows only the $35 coupon when it beats the multi-rug saving', async () => {
    await reviewRugs(150)
    expect(screen.getByText('$265.00')).toBeInTheDocument()
    expect(screen.queryByText('−$30.00')).toBeNull()
    expect(
      screen.getByText(/NEXTDOOR35 is applied instead/),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Booking' }))
    await screen.findByText("You're booked!")
    const request = vi
      .mocked(fetch)
      .mock.calls.find(([u]) => u === '/api/book')!
    const body = JSON.parse(String(request[1]?.body))
    expect(body.promo_code).toBe('NEXTDOOR35')
    expect(body.percentage_discount).toBeUndefined()
  })
})
