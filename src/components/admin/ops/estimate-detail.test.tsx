import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  requests = []
  saveSucceeds = false
  estimateStatus = 'accepted'
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
            converted_appointment_id: null,
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
})
