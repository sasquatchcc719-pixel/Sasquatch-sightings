// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
const deps = vi.hoisted(() => ({
  db: vi.fn(),
  promo: vi.fn(),
  catalog: vi.fn(),
  book: vi.fn(),
  slots: vi.fn(),
  staffSlots: vi.fn(),
  estimateSlots: vi.fn(),
  session: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: deps.db }))
vi.mock('@/app/api/public/promo-preview/route', () => ({ GET: deps.promo }))
vi.mock('@/lib/ops/bookable-catalog', () => ({
  loadBookableCatalog: deps.catalog,
}))
vi.mock('@/lib/ops/create-ai-style-booking', () => ({
  createAiStyleBooking: deps.book,
  GOOGLE_LSA_LEAD_RECOVERY_AMOUNT: 40,
}))
vi.mock('@/lib/ops/create-ai-style-estimate', () => ({
  commercialEstimateCalendarMinutes: () => 120,
}))
vi.mock('@/lib/ops/staff-availability', () => ({
  getUnionedSlots: deps.slots,
  getSlotsForStaff: deps.staffSlots,
  getStaffPrioritizedSlots: deps.estimateSlots,
}))
vi.mock('./records', () => ({ getVoiceSession: deps.session }))
import { phoneTools, runPhoneTool } from './engine'
const ctx = { callSid: 'test', callerPhone: '+15550100000', preview: true }
const id = '8fa3ee90-2ef6-4a7e-af0a-e67b5758f883'
const service = {
  zip_code: '80903',
  lead_source: 'repeat_customer',
  line_items: [{ service_id: id, quantity: 3 }],
}
const slot = {
  zip_code: service.zip_code,
  visit_type: 'residential_service',
  appointment_date: '2099-07-01',
  service,
}
const booking = {
  ...slot,
  start_time: '09:00',
  first_name: 'Example',
  last_name: 'Caller',
  email: 'caller@example.com',
  street: '1 Example St',
  city: 'Example',
  customer_confirmed: true,
  accepted_minimum_charge: false,
}
beforeEach(() => {
  vi.resetAllMocks()
  deps.db.mockReturnValue({})
  deps.catalog.mockResolvedValue([
    { id, name: 'Test Room', base_price: 100, pricing_unit: 'per_room' },
  ])
  deps.slots.mockResolvedValue([{ start_time: '09:00:00' }])
  deps.estimateSlots.mockResolvedValue({ slots: [{ start_time: '11:00:00' }] })
  deps.session.mockResolvedValue({ turns: [] })
  deps.book.mockResolvedValue({ ok: true, subtotal: 300 })
})
describe('customer voice preview', () => {
  it('publishes only valid read and simulation tool schemas', () => {
    expect(phoneTools).toHaveLength(6)
    for (const t of phoneTools)
      expect(z.toJSONSchema(t.inputSchema).type).toBe('object')
  })
  it('prices a normal call without an LSA fee and applies a validated coupon', async () => {
    deps.promo.mockResolvedValue(
      Response.json({ discount_amount: 35, applied: true }),
    )
    expect(
      await runPhoneTool(
        'phone_quote',
        { ...service, coupon_code: ' thanks 35 ' },
        ctx,
      ),
    ).toMatchObject({
      lsa_fee: 0,
      total: 265,
      coupon: { code: 'THANKS35', amount: 35 },
    })
    const query = deps.promo.mock.calls[0][0].nextUrl.searchParams
    expect(query.get('service_subtotal')).toBe('300')
    expect(query.get('subtotal')).toBe('300')
    expect(deps.book).not.toHaveBeenCalled()
  })
  it('requires separate attribution for LSA and returns two conditional totals when unclear', async () => {
    const input = { ...service, lead_source: 'google_lsa' }
    deps.session.mockResolvedValue({
      turns: [{ role: 'user', content: 'I found you on Google.' }],
    })
    expect(await runPhoneTool('phone_quote', input, ctx)).toMatchObject({
      status: 'conditional_quote',
      regular_search_total: 300,
      local_services_ad_total: 340,
    })
    deps.session.mockResolvedValue({
      turns: [
        {
          role: 'user',
          content: 'I found you through a Google Local Services ad.',
        },
      ],
    })
    expect(await runPhoneTool('phone_quote', input, ctx)).toMatchObject({
      lsa_fee: 40,
      total: 340,
    })
    deps.session.mockResolvedValue({
      turns: [
        {
          role: 'user',
          content: 'I found you through a Google Local Services ad.',
        },
        {
          role: 'user',
          content: 'Actually I did not use a local services ad.',
        },
      ],
    })
    expect(await runPhoneTool('phone_quote', input, ctx)).toMatchObject({
      status: 'conditional_quote',
    })
  })
  it('uses the service ZIP and shared minimum before calculating the discount', async () => {
    expect(
      await runPhoneTool(
        'phone_quote',
        { ...service, line_items: [{ service_id: id, quantity: 1 }] },
        ctx,
      ),
    ).toMatchObject({ subtotal: 175, minimum_adjustment: 75 })
    expect(
      await runPhoneTool('phone_openings', { ...slot, zip_code: '80201' }, ctx),
    ).toHaveProperty('error')
    expect(deps.slots).not.toHaveBeenCalled()
  })
  it('refuses unconfirmed, unavailable and public writes and uses pure preview for a recognized slot', async () => {
    expect(
      await runPhoneTool('phone_preview_booking', booking, {
        ...ctx,
        preview: false,
      }),
    ).toHaveProperty('error')
    expect(
      await runPhoneTool(
        'phone_preview_booking',
        { ...booking, customer_confirmed: false },
        ctx,
      ),
    ).toHaveProperty('error')
    expect(
      await runPhoneTool(
        'phone_preview_booking',
        { ...booking, start_time: '12:00' },
        ctx,
      ),
    ).toHaveProperty('error')
    expect(deps.book).not.toHaveBeenCalled()
    expect(
      await runPhoneTool('phone_preview_booking', booking, ctx),
    ).toMatchObject({ status: 'simulated', created: false })
    expect(deps.book).toHaveBeenCalledWith(
      expect.objectContaining({
        preview_only: true,
        notify_customer: false,
        notify_internal: false,
        sync_quickbooks: false,
        customer: expect.objectContaining({ phone: ctx.callerPhone }),
      }),
    )
  })
  it('validates commercial measuring times without executing a booking or residential quote', async () => {
    expect(
      await runPhoneTool(
        'phone_preview_booking',
        {
          ...booking,
          visit_type: 'commercial_measurement',
          service: undefined,
          start_time: '11:00',
        },
        ctx,
      ),
    ).toMatchObject({ created: false, status: 'simulated' })
    expect(deps.estimateSlots).toHaveBeenCalledWith(
      expect.objectContaining({ requiredMinutes: 120 }),
    )
    expect(deps.catalog).not.toHaveBeenCalled()
    expect(deps.book).not.toHaveBeenCalled()
  })
  it('rejects an unverified existing appointment without looking up other customers', async () => {
    const customerQuery = {
      in: vi
        .fn()
        .mockResolvedValue({ data: [{ id: '1', last_name: 'Different' }] }),
    }
    const from = vi.fn().mockReturnValue({ select: () => customerQuery })
    deps.db.mockReturnValue({ from })
    expect(
      await runPhoneTool(
        'phone_preview_change',
        { confirmation: 'SC-ABC12345', last_name: 'Caller', change: 'cancel' },
        ctx,
      ),
    ).toMatchObject({ error: expect.stringContaining('Unable to verify') })
    expect(from).toHaveBeenCalledTimes(1)
    expect(customerQuery.in).toHaveBeenCalledWith(
      'phone',
      expect.arrayContaining([ctx.callerPhone]),
    )
  })
})
