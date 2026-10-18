import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
}))
vi.mock('@/components/ops/street-view-card', () => ({
  StreetViewCard: () => null,
}))
vi.mock('@/components/ops/directions-buttons', () => ({
  DirectionsButtons: () => null,
}))
import { EstimateDetail } from './estimate-detail'

let requests: Array<{
  url: string
  method: string
  body: Record<string, unknown> | null
}>
let saveSucceeds: boolean
let estimateStatus: string
let convertedAppointmentId: string | null
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  requests = []
  saveSucceeds = false
  estimateStatus = 'accepted'
  convertedAppointmentId = null
  routerPush.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      const requestBody = init?.body ? JSON.parse(String(init.body)) : null
      requests.push({
        url,
        method,
        body: requestBody,
      })
      if (method === 'PATCH')
        return Response.json(
          saveSucceeds ? {} : { error: 'Database save failed' },
          { status: saveSucceeds ? 200 : 500 },
        )
      if (url.endsWith('/send-email') && requestBody?.action === 'preview')
        return Response.json({
          to_email: 'customer@example.com',
          subject: 'Your Estimate from Sasquatch Carpet Cleaning',
          body_text:
            'Hi Test,\n\n- Carpet cleaning: $100.00\n- Gym membership trade credit: -$150.00',
          html: '<p>Carpet cleaning: $100.00</p><p>Gym membership trade credit: -$150.00</p><a>Accept this estimate</a>',
          total: 100,
          preview_fingerprint: 'preview-fingerprint',
        })
      if (url.endsWith('/send-email'))
        return Response.json({
          success: true,
          to_email: 'customer@example.com',
          warning: null,
        })
      if (url === '/api/admin/ops/estimates/estimate-a')
        return Response.json({
          estimate: {
            id: 'estimate-a',
            kind: 'estimate',
            appointment_date: '2026-09-08',
            start_time: '10:00',
            end_time: '11:00',
            status: 'confirmed',
            estimate_status: estimateStatus,
            lead_source_key: 'google',
            converted_appointment_id: convertedAppointmentId,
            ops_customers: {
              id: 'customer-a',
              first_name: 'Test',
              last_name: 'Customer',
              full_name: 'Test Customer',
              email: 'customer@example.com',
              business_name: 'Test Business',
            },
            ops_appointment_line_items: [
              {
                id: 'line-a',
                name_snapshot: 'Carpet cleaning',
                quantity: 1,
                unit_price: 100,
                line_total: 100,
                pricing_unit_snapshot: 'each',
                duration_minutes: 60,
              },
            ],
          },
        })
      if (url === '/api/admin/ops/services')
        return Response.json({
          services: [
            {
              id: 'discount-service',
              name: 'Discount',
              slug: 'discount',
              category: 'Other',
              base_price: 0,
              pricing_unit: 'fixed',
              default_duration_minutes: 30,
            },
          ],
        })
      return Response.json({ options: [] })
    }),
  )
})

async function openReopenReview() {
  render(<EstimateDetail estimateId="estimate-a" />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Reopen & resend' }),
  )
  await screen.findByTitle('Estimate email preview')
  fireEvent.change(
    screen.getByLabelText('Reason for reopening (required, internal only)'),
    { target: { value: 'Approval disputed' } },
  )
}

describe('estimate editor send integration', () => {
  it('never sends after an unsuccessful save', async () => {
    saveSucceeds = true
    await openReopenReview()
    saveSucceeds = false
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirm reopen & send' }),
      )
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Save failed. No email was sent.',
    )
    expect(requests.some((r) => r.method === 'PATCH')).toBe(true)
    expect(
      requests.some(
        (r) => r.url.endsWith('/send-email') && r.body?.action === 'send',
      ),
    ).toBe(false)
  })
  it('saves before sending and passes the reviewed recipient, total, status and reason', async () => {
    saveSucceeds = true
    await openReopenReview()
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirm reopen & send' }),
      )
    })
    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.url.endsWith('/send-email') && r.body?.action === 'send',
        ),
      ).toBe(true),
    )
    const sendIndex = requests.findIndex(
      (r) => r.url.endsWith('/send-email') && r.body?.action === 'send',
    )
    expect(requests.findIndex((r) => r.method === 'PATCH')).toBeLessThan(
      sendIndex,
    )
    expect(requests[sendIndex].body).toMatchObject({
      type: 'quote',
      action: 'send',
      reopen: true,
      reason: 'Approval disputed',
      expected_email: 'customer@example.com',
      expected_total: 100,
      expected_status: 'accepted',
      request_id: expect.any(String),
      expected_fingerprint: 'preview-fingerprint',
    })
    await screen.findByRole('status')
  })

  it('adds a named trade credit, subtracts it, and saves it as the Discount catalog line', async () => {
    saveSucceeds = true
    render(<EstimateDetail estimateId="estimate-a" />)
    const addCredit = await screen.findByRole('button', {
      name: 'Add discount / trade credit',
    })
    await waitFor(() => expect(addCredit).toBeEnabled())
    fireEvent.click(addCredit)

    expect(screen.getByLabelText('Credit name')).toHaveValue(
      'Discount / trade credit',
    )
    expect(screen.getByLabelText('Credit amount')).toHaveValue(0)
    fireEvent.change(screen.getByLabelText('Credit name'), {
      target: { value: 'Referral courtesy discount' },
    })
    fireEvent.change(screen.getByLabelText('Credit amount'), {
      target: { value: '25' },
    })
    expect(screen.queryByText('Duration (min)')).not.toBeInTheDocument()
    expect(screen.getAllByText('$75.00').length).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    })
    await waitFor(() =>
      expect(requests.some((request) => request.method === 'PATCH')).toBe(true),
    )
    const saved = requests.find((request) => request.method === 'PATCH')
    expect(saved?.body?.line_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          service_catalog_item_id: 'discount-service',
          name_snapshot: 'Referral courtesy discount',
          quantity: 1,
          unit_price: -25,
          duration_minutes: 0,
        }),
      ]),
    )
  })

  it('separates real email sending from the manual sent status', async () => {
    saveSucceeds = true
    estimateStatus = 'draft'
    render(<EstimateDetail estimateId="estimate-a" />)

    expect(
      await screen.findByRole('button', { name: 'Review & send estimate' }),
    ).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', { name: 'Review & send estimate' }),
    )
    expect(
      await screen.findByRole('button', { name: 'Confirm & send email' }),
    ).toBeVisible()
    expect(screen.getByTitle('Estimate email preview')).toHaveAttribute(
      'srcdoc',
      expect.stringContaining('Gym membership trade credit: -$150.00'),
    )
    expect(
      screen.getByRole('button', { name: 'Record as sent manually' }),
    ).toHaveAttribute(
      'title',
      'Updates the estimate status only. It does not send an email.',
    )
    expect(screen.queryByText('Mark sent (no email)')).not.toBeInTheDocument()
    expect(screen.getByText(/Estimated service time: 2 hours/)).toBeVisible()
  })

  it('opens recurring setup from the converted service job', async () => {
    estimateStatus = 'converted'
    convertedAppointmentId = 'service-job-a'
    render(<EstimateDetail estimateId="estimate-a" />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Set up recurring visits' }),
    )

    expect(routerPush).toHaveBeenCalledWith(
      '/admin/operations/recurring?sourceAppointment=service-job-a',
    )
  })

  it('offers one-time and recurring scheduling before conversion', async () => {
    render(<EstimateDetail estimateId="estimate-a" />)

    expect(
      await screen.findByRole('button', { name: 'Schedule one visit' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Set up recurring visits' }),
    ).toBeVisible()
  })

  it('saves the estimate before opening recurring setup', async () => {
    saveSucceeds = true
    routerPush.mockImplementationOnce(() => {
      expect(requests.some((request) => request.method === 'PATCH')).toBe(true)
    })
    render(<EstimateDetail estimateId="estimate-a" />)

    const recurringButton = await screen.findByRole('button', {
      name: 'Set up recurring visits',
    })
    await act(async () => {
      fireEvent.click(recurringButton)
    })

    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(
        '/admin/operations/recurring?sourceAppointment=estimate-a',
      ),
    )
    expect(requests.some((request) => request.method === 'PATCH')).toBe(true)
  })
})

describe('estimate measurement units', () => {
  it('adds a new square-foot catalog service with measurement controls', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === '/api/admin/ops/services') {
        return Response.json({
          services: [
            {
              id: 'wall-service',
              name: 'Wall Tile cleaning',
              category: 'Hard Surface',
              pricing_unit: 'per_sqft',
              base_price: 1.25,
              default_duration_minutes: 30,
            },
            {
              id: 'floor-service',
              name: 'Tile & grout cleaning',
              category: 'Hard Surface',
              pricing_unit: 'per_sqft',
              base_price: 0.75,
              default_duration_minutes: 30,
            },
          ],
        })
      }
      return originalFetch(input, init)
    })
    render(<EstimateDetail estimateId="estimate-a" />)
    fireEvent.click(
      await screen.findByRole('button', { name: /Wall Tile cleaning/i }),
    )
    expect(screen.getByLabelText('Pricing unit for line 2')).toHaveValue(
      'per_sqft',
    )
    expect(screen.getByRole('button', { name: 'Add L×W' })).toBeVisible()
    expect(
      screen.getByRole('img', { name: 'Wall tile cleaning' }),
    ).toBeVisible()
    fireEvent.change(screen.getByLabelText('Name on proposal for line 2'), {
      target: { value: 'Mens restroom walls' },
    })
    expect(
      screen.getByRole('img', { name: 'Wall tile cleaning' }),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'View wall tile cleaning photo' }),
    ).toHaveAttribute('href', '/images/services/wall-tile-cleaning.png')
    fireEvent.change(screen.getByLabelText('Service for line 2'), {
      target: { value: 'floor-service' },
    })
    expect(
      screen.getByRole('img', { name: 'Floor tile and grout cleaning' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('img', { name: 'Wall tile cleaning' }),
    ).not.toBeInTheDocument()
  })

  it('measures an existing fixed-price catalog line, saves and reloads its square footage', async () => {
    saveSucceeds = true
    const wallLine = {
      id: 'wall-line',
      service_catalog_item_id: 'wall-service',
      name_snapshot: 'Wall Tile cleaning',
      notes: 'mens walls',
      quantity: 1,
      unit_price: 1.25,
      duration_minutes: 30,
      buffer_minutes: 0,
      line_total: 1.25,
      pricing_unit_snapshot: 'fixed',
      length_value: null,
      width_value: null,
      area_segments: null,
    }
    const originalFetch = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const response = await originalFetch(input, init)
      if (String(input) !== '/api/admin/ops/estimates/estimate-a')
        return response
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        Object.assign(wallLine, body.line_items[0])
        return response
      }
      const data = await response.json()
      data.estimate.ops_appointment_line_items = [wallLine]
      return Response.json(data)
    })

    render(<EstimateDetail estimateId="estimate-a" />)
    const unit = await screen.findByLabelText('Pricing unit for line 1')
    expect(
      screen.queryByRole('button', { name: 'Add L×W' }),
    ).not.toBeInTheDocument()
    fireEvent.change(unit, { target: { value: 'per_sqft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add L×W' }))
    fireEvent.change(screen.getByLabelText('Length for area 1 on line 1'), {
      target: { value: '10' },
    })
    fireEvent.change(screen.getByLabelText('Width for area 1 on line 1'), {
      target: { value: '8' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add L×W' }))
    fireEvent.change(screen.getByLabelText('Length for area 2 on line 1'), {
      target: { value: '5' },
    })
    fireEvent.change(screen.getByLabelText('Width for area 2 on line 1'), {
      target: { value: '4' },
    })
    expect(screen.getByText('10×8=80 + 5×4=20 → 100 sqft total')).toBeVisible()
    expect(screen.getByText(/Line total:/)).toHaveTextContent('$125.00')

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(wallLine).toMatchObject({
        pricing_unit_snapshot: 'per_sqft',
        quantity: 100,
        area_segments: [
          { length: 10, width: 8 },
          { length: 5, width: 4 },
        ],
        length_value: 10,
        width_value: 8,
        notes: 'mens walls',
        unit_price: 1.25,
      }),
    )
    expect(
      await screen.findByText('10×8=80 + 5×4=20 → 100 sqft total'),
    ).toBeVisible()
    expect(screen.getByLabelText('Pricing unit for line 1')).toHaveValue(
      'per_sqft',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect(
      screen.getAllByText('10×8=80 + 5×4=20 → 100 sqft total'),
    ).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Length for area 1 on line 2'), {
      target: { value: '20' },
    })
    expect(screen.getByText('20×8=160 + 5×4=20 → 180 sqft total')).toBeVisible()
    expect(screen.getByText('10×8=80 + 5×4=20 → 100 sqft total')).toBeVisible()

    fireEvent.change(screen.getByLabelText('Pricing unit for line 2'), {
      target: { value: 'fixed' },
    })
    expect(screen.getByLabelText('Pricing unit for line 1')).toHaveValue(
      'per_sqft',
    )
    expect(screen.getByLabelText('Quantity for line 2')).toHaveValue(180)
  })

  it('gives new custom lines the same area and linear measurement controls without changing credits', async () => {
    render(<EstimateDetail estimateId="estimate-a" />)
    fireEvent.click(
      await screen.findByRole('button', {
        name: /Custom line \(no catalog\)/i,
      }),
    )
    fireEvent.change(screen.getByLabelText('Pricing unit for line 2'), {
      target: { value: 'per_sqft' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add L×W' }))
    fireEvent.change(screen.getByLabelText('Length for area 1 on line 2'), {
      target: { value: '12' },
    })
    fireEvent.change(screen.getByLabelText('Width for area 1 on line 2'), {
      target: { value: '5' },
    })
    expect(screen.getByText('12×5=60 → 60 sqft total')).toBeVisible()
    fireEvent.change(screen.getByLabelText('Pricing unit for line 2'), {
      target: { value: 'per_linear_foot' },
    })
    expect(screen.getByText('Run 1: 12 ft → 12 linear ft total')).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', { name: 'Add discount / trade credit' }),
    )
    expect(
      screen.queryByLabelText('Pricing unit for line 3'),
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByLabelText('Pricing unit for line 2')).getByRole(
        'option',
        {
          name: 'Square feet (length × width)',
        },
      ),
    ).toBeInTheDocument()
  })
})

describe('collapsible estimate editor', () => {
  it('keeps edits and totals when a line is collapsed and expanded', async () => {
    render(<EstimateDetail estimateId="estimate-a" />)
    await screen.findByLabelText('Unit price for line 1')
    fireEvent.change(screen.getByLabelText('Name on proposal for line 1'), {
      target: { value: 'Office carpet' },
    })
    fireEvent.change(screen.getByLabelText('Unit price for line 1'), {
      target: { value: '85' },
    })
    fireEvent.change(
      screen.getByLabelText('Service notes (what, why, technique)'),
      {
        target: { value: 'Clean the traffic lanes' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Collapse line 1' }))
    expect(
      screen.getByRole('button', { name: 'Expand line 1' }),
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText('Unit price for line 1')).not.toBeVisible()
    expect(
      screen.getByLabelText('Service notes (what, why, technique)'),
    ).not.toBeVisible()
    expect(screen.getByText(/Line total:/)).toHaveTextContent('$85.00')
    expect(screen.getByText('Line 1 · Office carpet')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Expand line 1' }))
    expect(screen.getByLabelText('Unit price for line 1')).toHaveValue(85)
    expect(
      screen.getByLabelText('Service notes (what, why, technique)'),
    ).toHaveValue('Clean the traffic lanes')
  })

  it('collapses the information sections without discarding entered values', async () => {
    render(<EstimateDetail estimateId="estimate-a" />)
    await screen.findByRole('button', {
      name: 'Contact information',
    })
    fireEvent.change(screen.getByPlaceholderText('First name'), {
      target: { value: 'Charles' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Contact information' }))
    expect(screen.getByPlaceholderText('First name')).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Contact information' }))
    expect(screen.getByPlaceholderText('First name')).toHaveValue('Charles')
    fireEvent.click(screen.getByRole('button', { name: 'Service address' }))
    expect(screen.getByPlaceholderText('123 Main St')).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Measuring visit' }))
    expect(screen.getByLabelText('Date')).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Measuring visit' }))
    expect(screen.getByLabelText('Date')).toBeVisible()
  })

  it('opens, highlights, focuses and scrolls to a new line after collapsing all existing lines', async () => {
    const previousScroll = HTMLElement.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    try {
      render(<EstimateDetail estimateId="estimate-a" />)
      fireEvent.click(
        await screen.findByRole('button', { name: 'Collapse all lines' }),
      )
      fireEvent.click(
        screen.getByRole('button', { name: 'Custom line (no catalog)' }),
      )
      expect(
        screen.getByRole('button', { name: 'Expand line 1' }),
      ).toBeVisible()
      expect(
        screen.getByRole('button', { name: 'Collapse line 2' }),
      ).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByLabelText('Name on proposal for line 2')).toBeVisible()
      expect(screen.getByRole('status')).toHaveTextContent('Added custom line')
      expect(document.activeElement?.id).toMatch(/^estimate-line-new-/)
      expect(document.activeElement).toHaveClass('ring-2')
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
      })
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: previousScroll,
      })
    }
  })
})
