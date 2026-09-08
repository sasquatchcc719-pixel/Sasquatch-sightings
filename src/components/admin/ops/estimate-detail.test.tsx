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
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  requests = []
  saveSucceeds = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      requests.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      if (method === 'PATCH')
        return Response.json(
          saveSucceeds ? {} : { error: 'Database save failed' },
          { status: saveSucceeds ? 200 : 500 },
        )
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
            estimate_status: 'accepted',
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
      return Response.json({ services: [], options: [] })
    }),
  )
})

async function confirmReopen() {
  render(<EstimateDetail estimateId="estimate-a" />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Reopen & resend' }),
  )
  fireEvent.change(
    screen.getByLabelText('Reason for reopening (required, internal only)'),
    { target: { value: 'Approval disputed' } },
  )
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm reopen & send' }),
    )
  })
}

describe('estimate editor send integration', () => {
  it('never sends after an unsuccessful save', async () => {
    await confirmReopen()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Save failed. No email was sent.',
    )
    expect(requests.some((r) => r.method === 'PATCH')).toBe(true)
    expect(requests.some((r) => r.url.endsWith('/send-email'))).toBe(false)
  })
  it('saves before sending and passes the reviewed recipient, total, status and reason', async () => {
    saveSucceeds = true
    await confirmReopen()
    await waitFor(() =>
      expect(requests.some((r) => r.url.endsWith('/send-email'))).toBe(true),
    )
    const sendIndex = requests.findIndex((r) => r.url.endsWith('/send-email'))
    expect(requests.findIndex((r) => r.method === 'PATCH')).toBeLessThan(
      sendIndex,
    )
    expect(requests[sendIndex].body).toMatchObject({
      type: 'quote',
      reopen: true,
      reason: 'Approval disputed',
      expected_email: 'customer@example.com',
      expected_total: 100,
      expected_status: 'accepted',
      request_id: expect.any(String),
    })
    await screen.findByRole('status')
  })
})
