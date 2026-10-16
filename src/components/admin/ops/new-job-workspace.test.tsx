import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewJobWorkspace } from './new-job-workspace'

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams('mode=estimate'),
  router: { push: vi.fn(), refresh: vi.fn() },
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => navigation.params,
  useRouter: () => navigation.router,
}))
vi.mock('./day-time-picker', () => ({
  DayTimePicker: () => <div>Booking day and time picker</div>,
}))
vi.mock('./city-quick-pick', () => ({ CityQuickPick: () => null }))

type RequestBody = Record<string, unknown>
const requests: Array<{ url: string; method: string; body?: RequestBody }> = []

function postRequests() {
  return requests.filter((request) => request.method === 'POST')
}

beforeEach(() => {
  requests.length = 0
  navigation.params = new URLSearchParams('mode=estimate')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method || 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      requests.push({ url, method, body })
      let payload: unknown
      if (url === '/api/admin/ops/bootstrap') {
        payload = {
          services: [
            {
              id: 'carpet-room',
              name: 'Room Carpet Cleaning',
              category: 'Residential',
              base_price: 50,
              pricing_unit: 'each',
              default_duration_minutes: 30,
              buffer_minutes: 0,
            },
          ],
        }
      } else if (url.startsWith('/api/admin/ops/schedule?')) {
        payload = {
          appointments: [],
          events: [],
          dailyAvailability: [],
          staff: [
            {
              id: 'staff-a',
              display_name: 'Charles',
              default_open: true,
              scheduling_priority: 1,
            },
          ],
        }
      } else if (url === '/api/public/lead-sources') {
        payload = { options: [] }
      } else if (url === '/api/admin/promo-codes') {
        payload = {
          promo_codes: [
            {
              id: 'military-promo',
              code: 'MILITARY',
              discount_type: 'flat',
              discount_amount: 10,
              description: 'Military discount',
              active: true,
              expires_at: null,
              max_uses: null,
              use_count: 0,
            },
            {
              id: 'partner-promo',
              code: 'PARTNER10',
              discount_type: 'percent',
              discount_amount: 10,
              description: 'Referral partner discount',
              active: true,
              expires_at: null,
              max_uses: null,
              use_count: 0,
            },
            {
              id: 'glam-promo',
              code: 'GLAM20',
              discount_type: 'flat',
              discount_amount: 20,
              description: 'Glamour Salon partner discount',
              active: true,
              expires_at: null,
              max_uses: null,
              use_count: 0,
            },
            {
              id: 'expired-promo',
              code: 'OLD20',
              discount_type: 'flat',
              discount_amount: 20,
              description: 'Expired discount',
              active: true,
              expires_at: '2020-01-01T00:00:00.000Z',
              max_uses: null,
              use_count: 0,
            },
          ],
        }
      } else if (url.startsWith('/api/public/promo-preview?')) {
        payload = { applied: true, discount_amount: 10 }
      } else if (url.startsWith('/api/admin/ops/slots?')) {
        payload = { slots: [{ start_time: '09:00', end_time: '12:00' }] }
      } else if (url === '/api/admin/ops/appointments') {
        payload = { appointment_id: 'new-job' }
      } else if (url === '/api/admin/ops/residential-estimate') {
        payload =
          body.action === 'preview'
            ? {
                to_email: body.recipient_email,
                subject: 'Your Sasquatch Carpet Cleaning estimate',
                body_text: 'Your cleaning estimate is $85.00.',
                html: '<p>Your cleaning estimate is $85.00.</p>',
                total: 85,
                preview_fingerprint: 'preview-reviewed',
              }
            : { to_email: body.recipient_email }
      } else {
        throw new Error(`Unexpected request: ${method} ${url}`)
      }
      return { ok: true, status: 200, json: async () => payload }
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function enterEstimate() {
  const quantity = await screen.findByRole('spinbutton', {
    name: 'Room Carpet Cleaning quantity',
  })
  fireEvent.change(quantity, { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Send estimate to *'), {
    target: { value: 'neighbor@example.com' },
  })
  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: 'Preview estimate email',
      }),
    ).toBeEnabled(),
  )
}

async function openCouponCodes() {
  const toggle = await screen.findByRole('button', { name: /^Coupon codes/ })
  if (toggle.getAttribute('aria-expanded') === 'false') {
    fireEvent.click(toggle)
  }
}

describe('Book Job residential estimate mode', () => {
  it('shows every available coupon as a one-tap calculation button', async () => {
    render(<NewJobWorkspace />)

    const couponToggle = await screen.findByRole('button', {
      name: 'Coupon codes 3 available',
    })
    expect(couponToggle).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('button', { name: 'GLAM20 $20 off' }),
    ).not.toBeInTheDocument()

    fireEvent.click(couponToggle)
    expect(couponToggle).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('button', { name: 'GLAM20 $20 off' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'MILITARY $10 off' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'PARTNER10 10% off' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /OLD20/ }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('More coupon codes')).not.toBeInTheDocument()

    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'Room Carpet Cleaning quantity',
      }),
      { target: { value: '2' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'PARTNER10 10% off' }))

    expect(
      await screen.findByText('PARTNER10 applied — $10.00 off.'),
    ).toBeInTheDocument()
    expect(couponToggle).toHaveAccessibleName('Coupon codes PARTNER10 selected')
    expect(screen.getAllByText('$90.00').length).toBeGreaterThan(0)
  })

  it('opens without creating records and blocks implicit form submission', async () => {
    const { container } = render(<NewJobWorkspace />)
    await screen.findByRole('spinbutton', {
      name: 'Room Carpet Cleaning quantity',
    })

    expect(
      screen.getByRole('button', { name: 'Continue to booking' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Schedule' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Save Job' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Lead Source *')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Booking day and time picker'),
    ).not.toBeInTheDocument()
    expect(postRequests()).toEqual([])

    fireEvent.submit(container.querySelector('form')!)

    expect(postRequests()).toEqual([])
    expect(navigation.router.push).not.toHaveBeenCalled()
    expect(
      requests.some(({ url }) => url.startsWith('/api/admin/ops/slots?')),
    ).toBe(false)
  })

  it('previews and sends selected services and custom discount using only an email address', async () => {
    render(<NewJobWorkspace />)
    await enterEstimate()
    await openCouponCodes()
    fireEvent.change(screen.getByLabelText('Custom discount ($)'), {
      target: { value: '15' },
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Preview estimate email' }),
    )
    const send = await screen.findByRole('button', {
      name: 'Send estimate email',
    })
    const preview = postRequests()[0]
    expect(preview.url).toBe('/api/admin/ops/residential-estimate')
    expect(preview.body).toMatchObject({
      action: 'preview',
      recipient_email: 'neighbor@example.com',
      customer_id: null,
      customer: {
        first_name: '',
        last_name: '',
        phone: '',
        email: 'neighbor@example.com',
      },
      address: { street_1: '', zip_code: '' },
      line_items: [
        {
          service_catalog_item_id: 'carpet-room',
          name_snapshot: 'Room Carpet Cleaning',
          quantity: 2,
          unit_price: 50,
        },
      ],
      promo_code: null,
      discount_amount: 15,
    })
    expect(preview.body).not.toHaveProperty('appointment')
    expect(preview.body).not.toHaveProperty('appointment_date')
    expect(preview.body).not.toHaveProperty('lead_source_key')
    expect(postRequests()).toHaveLength(1)

    fireEvent.click(send)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Estimate email sent to neighbor@example.com for $85.00. No appointment was created.',
    )
    expect(postRequests()).toHaveLength(2)
    expect(postRequests()[1]).toMatchObject({
      url: '/api/admin/ops/residential-estimate',
      body: {
        ...preview.body,
        action: 'send',
        expected_fingerprint: 'preview-reviewed',
        request_id: expect.any(String),
      },
    })
    expect(
      requests.some(({ url }) => url === '/api/admin/ops/appointments'),
    ).toBe(false)
    expect(navigation.router.push).not.toHaveBeenCalled()
  })

  it('passes a selected coupon without applying its displayed discount twice', async () => {
    render(<NewJobWorkspace />)
    await enterEstimate()
    await openCouponCodes()
    fireEvent.click(screen.getByRole('button', { name: 'MILITARY $10 off' }))
    await screen.findByText('MILITARY applied — $10.00 off.')

    fireEvent.click(
      screen.getByRole('button', { name: 'Preview estimate email' }),
    )
    await screen.findByRole('button', { name: 'Send estimate email' })

    expect(postRequests()).toHaveLength(1)
    expect(postRequests()[0].body).toMatchObject({
      promo_code: 'MILITARY',
      discount_amount: 0,
      line_items: [{ quantity: 2, unit_price: 50 }],
    })
  })

  it('restores scheduling and booking validation while keeping the quote when switching back', async () => {
    render(<NewJobWorkspace />)
    await enterEstimate()
    await openCouponCodes()
    fireEvent.change(screen.getByLabelText('Custom discount ($)'), {
      target: { value: '15' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue to booking' }))

    expect(
      screen.getByRole('heading', { name: 'Schedule' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Job' })).toBeInTheDocument()
    expect(screen.getByLabelText('Lead Source *')).toHaveValue('')
    expect(screen.getByText('Booking day and time picker')).toBeInTheDocument()
    expect(screen.getByLabelText('Email *')).toHaveValue('neighbor@example.com')
    expect(screen.getByLabelText('Room Carpet Cleaning quantity')).toHaveValue(
      2,
    )
    expect(screen.getByLabelText('Custom discount ($)')).toHaveValue(15)
    expect(postRequests()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Save Job' }))
    expect(
      await screen.findByText('Please select a lead source before saving.'),
    ).toBeInTheDocument()
    expect(postRequests()).toEqual([])

    fireEvent.click(
      screen.getByRole('button', { name: 'Email estimate instead' }),
    )
    expect(
      screen.queryByRole('heading', { name: 'Schedule' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Save Job' }),
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Send estimate to *')).toHaveValue(
      'neighbor@example.com',
    )
    expect(
      screen.queryByText('Please select a lead source before saving.'),
    ).not.toBeInTheDocument()
    expect(postRequests()).toEqual([])
  })
})

describe('Book Job automatic minimum', () => {
  beforeEach(() => {
    navigation.params = new URLSearchParams()
  })

  it('shrinks and removes the adjustment as services grow, then restores it when reduced', async () => {
    render(<NewJobWorkspace />)
    const quantity = await screen.findByLabelText(
      'Room Carpet Cleaning quantity',
    )
    expect(
      screen.queryByLabelText('Minimum Dispatch Adjustment ($)'),
    ).not.toBeInTheDocument()
    fireEvent.change(quantity, { target: { value: '1' } })
    expect(
      screen.getByLabelText('Minimum Dispatch Adjustment ($)'),
    ).toHaveValue(125)
    expect(screen.getAllByText('$175.00').length).toBeGreaterThan(0)
    fireEvent.change(quantity, { target: { value: '2' } })
    expect(
      screen.getByLabelText('Minimum Dispatch Adjustment ($)'),
    ).toHaveValue(75)
    fireEvent.change(quantity, { target: { value: '4' } })
    expect(
      screen.getByLabelText('Minimum Dispatch Adjustment ($)'),
    ).toHaveValue(0)
    expect(screen.getAllByText('$200.00').length).toBeGreaterThan(0)
    fireEvent.change(quantity, { target: { value: '1' } })
    expect(
      screen.getByLabelText('Minimum Dispatch Adjustment ($)'),
    ).toHaveValue(125)
    fireEvent.change(quantity, { target: { value: '0' } })
    expect(
      screen.queryByLabelText('Minimum Dispatch Adjustment ($)'),
    ).not.toBeInTheDocument()
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0)
  })

  it('saves the displayed adjustment as a custom line and allows an intentional override', async () => {
    const { container } = render(<NewJobWorkspace />)
    const quantity = await screen.findByLabelText(
      'Room Carpet Cleaning quantity',
    )
    fireEvent.change(quantity, { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Lead Source *'), {
      target: { value: 'repeat_customer' },
    })
    // Submit directly: this test covers the payload boundary without browser-required fields.
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(postRequests()).toHaveLength(1))
    expect(postRequests()[0].body?.line_items).toEqual([
      expect.objectContaining({
        service_catalog_item_id: 'carpet-room',
        quantity: 1,
        unit_price: 50,
      }),
      expect.objectContaining({
        service_catalog_item_id: null,
        name_snapshot: 'Minimum Dispatch Adjustment',
        quantity: 1,
        unit_price: 125,
        duration_minutes: 0,
      }),
    ])
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Job' })).toBeEnabled(),
    )
    fireEvent.change(screen.getByLabelText('Minimum Dispatch Adjustment ($)'), {
      target: { value: '0' },
    })
    fireEvent.change(quantity, { target: { value: '2' } })
    expect(
      screen.getByLabelText('Minimum Dispatch Adjustment ($)'),
    ).toHaveValue(0)
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0)
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(postRequests()).toHaveLength(2))
    expect(postRequests()[1].body?.line_items).toEqual([
      expect.objectContaining({ quantity: 2, unit_price: 50 }),
    ])
    fireEvent.click(
      screen.getByRole('button', { name: 'Use automatic minimum' }),
    )
    expect(
      screen.getByLabelText('Minimum Dispatch Adjustment ($)'),
    ).toHaveValue(75)
  })

  it('counts custom charges and prices the minimum before an intentional discount', async () => {
    render(<NewJobWorkspace />)
    fireEvent.change(
      await screen.findByLabelText('Room Carpet Cleaning quantity'),
      { target: { value: '1' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add Custom Line' }))
    fireEvent.change(screen.getAllByLabelText('Unit Price')[1], {
      target: { value: '25.50' },
    })
    expect(
      screen.getByLabelText('Minimum Dispatch Adjustment ($)'),
    ).toHaveValue(99.5)
    await openCouponCodes()
    fireEvent.change(screen.getByLabelText('Custom discount ($)'), {
      target: { value: '10' },
    })
    expect(
      screen.getByLabelText('Minimum Dispatch Adjustment ($)'),
    ).toHaveValue(99.5)
    expect(screen.getAllByText('$165.00').length).toBeGreaterThan(0)
  })

  it('does not add a minimum to warranty work', async () => {
    render(<NewJobWorkspace />)
    fireEvent.change(
      await screen.findByLabelText('Room Carpet Cleaning quantity'),
      { target: { value: '1' } },
    )
    fireEvent.change(screen.getByLabelText('Display Name'), {
      target: { value: 'Warranty Re-clean' },
    })
    expect(
      screen.queryByLabelText('Minimum Dispatch Adjustment ($)'),
    ).not.toBeInTheDocument()
    expect(screen.getAllByText('$50.00').length).toBeGreaterThan(0)
  })
})
