// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { writeFileSync } from 'node:fs'
const state = vi.hoisted(() => ({
  invoices: [] as any[],
  appointments: [] as any[],
  customerWrites: 0,
  travel: 0,
  db: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: state.db }))
vi.mock('@/lib/blacklist', () => ({
  isBlacklisted: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/service-area', () => ({
  checkServiceArea: () => ({ allowed: true, travelCharge: state.travel }),
}))
vi.mock('@/lib/ops/staff-availability', () => ({
  getStaffPrioritizedSlots: vi.fn().mockResolvedValue({
    staffUserId: 'staff',
    slots: [{ start_time: '10:00:00' }],
  }),
}))
vi.mock('@/lib/ops/customers', () => ({
  resolveOpsCustomer: async () => {
    state.customerWrites++
    return { id: 'customer', quickbooks_customer_id: null }
  },
}))
vi.mock('@/lib/ops/addresses', () => ({
  resolveServiceAddress: vi.fn().mockResolvedValue({ id: 'address' }),
}))
vi.mock('@/lib/server/lead-sources', () => ({
  normalizeLeadSourceForWrite: vi
    .fn()
    .mockResolvedValue({ ok: true, source: { lead_source: 'Website' } }),
  leadSourceUpdatePayload: () => ({}),
}))
vi.mock('@/lib/ops/reactivation-campaign', () => ({
  cancelReactivationForCustomer: vi.fn(),
  describeReactivationTouch: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/ops/communications', () => ({
  sendOpsLifecycleCommunications: vi.fn(),
}))
vi.mock('@/lib/quickbooks-api', () => ({
  syncAppointmentToQuickBooks: vi.fn(),
}))
vi.mock('@/lib/ops/quickbooks-sync-jobs', () => ({
  ensureCustomerQuickBooksSyncJob: vi.fn(),
}))
vi.mock('@/lib/quickbooks', () => ({ buildQuickBooksCustomerPayload: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendAdminSMS: vi.fn() }))
vi.mock('@/lib/onesignal', () => ({ sendOneSignalNotification: vi.fn() }))
vi.mock('@/lib/ops/customer-photo-upload-token', () => ({
  createCustomerPhotoUploadToken: vi.fn().mockReturnValue('synthetic'),
}))
vi.mock('@/lib/ops/tomorrow-fill', () => ({
  validateTomorrowFillPromoToken: vi.fn(),
  reserveTomorrowFillOffer: vi.fn(),
  releaseTomorrowFillOffer: vi.fn(),
  finalizeTomorrowFillBooking: vi.fn(),
}))
import { POST } from './route'
function db() {
  return {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from(table: string) {
      let inserted: any
      const q = {
        select() {
          return q
        },
        eq() {
          return q
        },
        ilike() {
          return q
        },
        in() {
          return q
        },
        update() {
          return q
        },
        insert(v: any) {
          inserted = v
          if (table === 'ops_invoices')
            state.invoices.push({
              ...v,
              id: '90000000-0000-4000-8000-000000000002',
            })
          if (table === 'ops_appointments')
            state.appointments.push({
              ...v,
              id: '90000000-0000-4000-8000-000000000001',
            })
          return q
        },
        async maybeSingle() {
          return {
            data:
              table === 'promo_codes'
                ? {
                    id: 'promo',
                    discount_type: 'tiered',
                    discount_amount: 0,
                    expires_at: null,
                    max_uses: null,
                    use_count: 0,
                  }
                : table === 'staff_users'
                  ? { display_name: 'Fixture tech' }
                  : null,
            error: null,
          }
        },
        async single() {
          return {
            data: {
              id:
                table === 'ops_invoices'
                  ? '90000000-0000-4000-8000-000000000002'
                  : '90000000-0000-4000-8000-000000000001',
              reactivation_click_id: null,
            },
            error: null,
          }
        },
        then(resolve: any) {
          resolve({
            data:
              table === 'service_catalog_items'
                ? [
                    {
                      id: 'service',
                      name: 'Cleaning',
                      category: 'Carpet Cleaning',
                      slug: 'carpet',
                      pricing_unit: 'fixed',
                    },
                    {
                      id: 'tax',
                      name: 'Tax',
                      category: 'Tax',
                      slug: 'tax',
                      pricing_unit: 'fixed',
                    },
                  ]
                : [],
            error: null,
          })
        },
      }
      return q
    },
  }
}
function req(service = 300, extra: Record<string, any> = {}) {
  return new NextRequest('https://example.test/api/public/appointments', {
    method: 'POST',
    headers: { 'x-booking-secret': 'synthetic' },
    body: JSON.stringify({
      customer: {
        first_name: 'Synthetic',
        last_name: 'Only',
        email: 'fixture@example.test',
        phone: '7195550100',
      },
      address: { street_1: '123 Fixture', city: 'Monument', zip_code: '80132' },
      appointment: { appointment_date: '2030-01-10', start_time: '10:00' },
      line_items: [
        {
          service_catalog_item_id: 'service',
          name_snapshot: 'Cleaning',
          quantity: 1,
          unit_price: service,
        },
      ],
      promo_code: 'NEXTDOOR35',
      ...extra,
    }),
  })
}
beforeEach(() => {
  state.invoices = []
  state.appointments = []
  state.customerWrites = 0
  state.travel = 0
  state.db.mockReturnValue(db())
  vi.stubEnv('BOOKING_API_SECRET', 'synthetic')
  vi.stubEnv('RESEND_API_KEY', '')
})
afterEach(() => vi.unstubAllEnvs())
describe('public NEXTDOOR35 booking and stored invoice fixture', () => {
  it('rejects $299.99 service plus $25 travel before customer/invoice writes', async () => {
    state.travel = 25
    const r = await POST(req(299.99))
    expect(r.status).toBe(400)
    expect(await r.json()).toMatchObject({
      error: expect.stringContaining('$300'),
    })
    expect(state.customerWrites).toBe(0)
    expect(state.invoices).toHaveLength(0)
  })
  it('books ordinary public customer at $300 without a private token; invoice preserves $35/$265 and offer metadata', async () => {
    const r = await POST(req())
    expect(r.status).toBe(200)
    expect(state.invoices).toHaveLength(1)
    expect(state.invoices[0]).toMatchObject({
      subtotal: 300,
      discount_amount: 35,
      percentage_discount_amount: 0,
      total: 265,
      discount_metadata: {
        promo: { code: 'NEXTDOOR35', amount: 35 },
        public_offer: {
          minimum_service_cents: 30000,
          service_subtotal: 300,
          stacking: false,
        },
      },
    })
    expect(state.appointments[0]).toMatchObject({ quoted_total: 265 })
    if (process.env.NEXTDOOR_FIXTURE_OUTPUT)
      writeFileSync(
        process.env.NEXTDOOR_FIXTURE_OUTPUT,
        JSON.stringify({
          invoice: state.invoices[0],
          appointment: state.appointments[0],
        }),
      )
  })
  it('keeps travel charge in invoice totals without using it for qualification', async () => {
    state.travel = 25
    const r = await POST(req())
    expect(r.status).toBe(200)
    expect(state.invoices[0]).toMatchObject({
      subtotal: 325,
      discount_amount: 35,
      total: 290,
    })
  })
  it('rejects stacking percentage, other discount, credits or private token before writes', async () => {
    for (const extra of [
      { percentage_discount: { scope: 'rug_cleaning' } },
      { discount_amount: 20 },
      { tomorrow_fill_token: 'private-token' },
      {
        line_items: [
          { name_snapshot: 'Cleaning', unit_price: 350, quantity: 1 },
          { name_snapshot: 'Credit', unit_price: -10, quantity: 1 },
        ],
      },
    ]) {
      const r = await POST(req(300, extra))
      expect(r.status).toBe(400)
    }
    expect(state.invoices).toHaveLength(0)
    expect(state.customerWrites).toBe(0)
  })
  it('does not count catalog tax mislabeled as service toward the threshold', async () => {
    const r = await POST(
      req(299.99, {
        line_items: [
          {
            service_catalog_item_id: 'service',
            name_snapshot: 'Cleaning',
            unit_price: 299.99,
            quantity: 1,
          },
          {
            service_catalog_item_id: 'tax',
            name_snapshot: 'Extra service',
            category: 'Carpet Cleaning',
            unit_price: 25,
            quantity: 1,
          },
        ],
      }),
    )
    expect(r.status).toBe(400)
    expect(state.invoices).toHaveLength(0)
  })
})
