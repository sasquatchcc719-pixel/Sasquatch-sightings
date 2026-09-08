// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ access: vi.fn(), db: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/server/lead-sources', () => ({
  leadSourceUpdatePayload: vi.fn(),
  normalizeLeadSourceForWrite: vi.fn(),
}))
import { GET, PATCH } from './route'

const context = { params: Promise.resolve({ id: 'estimate-a' }) }
let failTable: string | null
let touched: string[]
let filters: unknown[][]
beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ id: 'staff-a' })
  failTable = null
  touched = []
  filters = []
  mocks.db.mockReturnValue({
    from: (table: string) => {
      touched.push(table)
      const result = {
        data:
          table === 'ops_email_log'
            ? {
                to_email: 'customer@example.com',
                sent_at: '2026-09-08T21:04:00Z',
              }
            : {
                id: 'estimate-a',
                customer_id: 'customer-a',
                service_address_id: 'address-a',
              },
        error: table === failTable ? { message: 'Write failed' } : null,
      }
      const builder = {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn((...args: unknown[]) => {
          filters.push([table, ...args])
          return builder
        }),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
        maybeSingle: vi.fn().mockResolvedValue(result),
        then: (resolve: (value: typeof result) => unknown) =>
          Promise.resolve(result).then(resolve),
      }
      return builder
    },
  })
})

describe('estimate details used by the resend workflow', () => {
  it('shows only this estimate’s last recorded quote, not appointment confirmations', async () => {
    const response = await GET(
      new NextRequest('https://example.com/api/estimate'),
      context,
    )
    expect(await response.json()).toMatchObject({
      last_quote_email: { to_email: 'customer@example.com' },
      email_history_unavailable: false,
    })
    expect(filters).toContainEqual([
      'ops_email_log',
      'appointment_id',
      'estimate-a',
    ])
    expect(filters).toContainEqual(['ops_email_log', 'template_key', 'quote'])
    expect(filters).toContainEqual(['ops_email_log', 'status', 'sent'])
  })
  it('does not mistake unavailable history for no email having been sent', async () => {
    failTable = 'ops_email_log'
    expect(
      await (
        await GET(new NextRequest('https://example.com/api/estimate'), context)
      ).json(),
    ).toMatchObject({ email_history_unavailable: true })
  })
  it.each([
    ['ops_customers', { customer: { email: 'new@example.com' } }],
    ['ops_service_addresses', { address: { street_1: '123 Test Street' } }],
  ])('stops when %s cannot be saved', async (table, body) => {
    failTable = table
    const response = await PATCH(
      new NextRequest('https://example.com/api/estimate', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
      context,
    )
    expect(response.status).toBe(500)
    expect(touched).toEqual(['ops_appointments', table])
  })
})
