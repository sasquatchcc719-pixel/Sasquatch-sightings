// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
afterEach(() => vi.unstubAllEnvs())
beforeEach(() => {
  vi.stubEnv('HARRY_VOICE_WEBHOOK_SECRET', 'test-key')
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
    expect(phoneTools).toHaveLength(7)
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
  it.each([
    [362, 362, false],
    [175, 175, false],
    [120, 175, true],
  ])(
    'distinguishes a $%i service from a minimum charge',
    async (price, total, applied) => {
      deps.catalog.mockResolvedValue([
        { id, name: 'Cleaning', base_price: price },
      ])
      const result = await runPhoneTool(
        'phone_quote',
        {
          ...service,
          line_items: [{ service_id: id, quantity: 1 }],
        },
        ctx,
      )
      expect(result).toMatchObject({ total, minimum_charge_applied: applied })
      if (applied) expect(result).toHaveProperty('minimum_charge', 175)
      else expect(result).not.toHaveProperty('minimum_charge')
    },
  )
  it('does not ask for minimum acceptance when a coupon alone takes the total below the floor', async () => {
    deps.catalog.mockResolvedValue([{ id, name: 'Cleaning', base_price: 190 }])
    deps.promo.mockResolvedValue(
      Response.json({ discount_amount: 35, applied: true }),
    )
    expect(
      await runPhoneTool(
        'phone_quote',
        {
          ...service,
          line_items: [{ service_id: id, quantity: 1 }],
          coupon_code: 'EXAMPLE',
        },
        ctx,
      ),
    ).toMatchObject({ total: 155, minimum_charge_applied: false })
  })
  it('quotes and finds times before attribution, then requires it before confirming', async () => {
    const items = { zip_code: service.zip_code, line_items: service.line_items }
    const estimate = { status: 'standard_estimate', total: 300, lsa_fee: 0 }
    expect(await runPhoneTool('phone_quote', items, ctx)).toMatchObject(
      estimate,
    )
    expect(
      await runPhoneTool('phone_openings', { ...slot, service: items }, ctx),
    ).toMatchObject({
      times: ['09:00'],
      quote: estimate,
    })
    expect(
      await runPhoneTool(
        'phone_preview_booking',
        { ...booking, service: items },
        ctx,
      ),
    ).toMatchObject({ error: expect.stringContaining('source') })
    expect(deps.book).not.toHaveBeenCalled()
  })
  it('can show openings for an unclear Google source without confirming that price', async () => {
    const items = { ...service, lead_source: 'google_unsure' }
    expect(
      await runPhoneTool('phone_openings', { ...slot, service: items }, ctx),
    ).toMatchObject({
      times: ['09:00'],
      quote: { status: 'standard_estimate', total: 300 },
    })
    expect(
      await runPhoneTool(
        'phone_preview_booking',
        { ...booking, service: items },
        ctx,
      ),
    ).toMatchObject({ error: expect.stringContaining('source') })
    expect(deps.book).not.toHaveBeenCalled()
  })
  it('finds the first four-hour opening across closed or full days without asking for a date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-19T20:10:00Z'))
    try {
      deps.catalog.mockResolvedValue([
        { id, name: 'Cleaning', base_price: 684 },
      ])
      deps.slots.mockImplementation(async ({ date, requiredMinutes }) =>
        date === '2026-11-23' && requiredMinutes === 240
          ? [{ start_time: '11:00:00' }]
          : [],
      )
      const result = await runPhoneTool(
        'phone_openings',
        {
          visit_type: slot.visit_type,
          zip_code: slot.zip_code,
          service: {
            ...service,
            line_items: [{ service_id: id, quantity: 1 }],
          },
        },
        ctx,
      )
      expect(result).toMatchObject({
        date: '2026-11-23',
        times: ['11:00'],
        quote: { total: 684 },
      })
      expect(deps.slots.mock.calls[0][0]).toMatchObject({
        date: '2026-11-19',
        minStartMinutes: 850,
      })
      expect(deps.catalog).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it('keeps exact dates and booking validation on the requested day', async () => {
    deps.slots.mockResolvedValue([])
    expect(await runPhoneTool('phone_openings', slot, ctx)).toMatchObject({
      date: slot.appointment_date,
      times: [],
    })
    expect(deps.slots).toHaveBeenCalledTimes(1)
    expect(
      await runPhoneTool(
        'phone_preview_booking',
        { ...booking, appointment_date: undefined },
        ctx,
      ),
    ).toHaveProperty('error')
    expect(deps.book).not.toHaveBeenCalled()
  })
  it('reports the searched range and resumes from its next day for measuring visits', async () => {
    const request = {
      visit_type: 'commercial_measurement',
      zip_code: '80903',
      search_from: '2099-12-24',
    }
    deps.estimateSlots.mockResolvedValue(null)
    expect(await runPhoneTool('phone_openings', request, ctx)).toMatchObject({
      times: [],
      searched_from: '2099-12-24',
      searched_through: '2100-01-06',
      next_search_from: '2100-01-07',
    })
    expect(deps.estimateSlots).toHaveBeenCalledTimes(14)
    deps.estimateSlots.mockResolvedValue({
      slots: [{ start_time: '11:00:00' }],
    })
    expect(
      await runPhoneTool(
        'phone_openings',
        { ...request, search_from: '2100-01-07' },
        ctx,
      ),
    ).toMatchObject({ date: '2100-01-07', times: ['11:00'] })
  })
  it('uses the verified duration for a quoted availability lookup without repricing', async () => {
    const q = (await runPhoneTool('phone_quote', service, ctx)) as {
      quote_ref: string
    }
    expect(q.quote_ref).toBeTruthy()
    const request = {
      quote_ref: q.quote_ref,
      appointment_date: slot.appointment_date,
    }
    expect(
      await runPhoneTool('phone_quoted_openings', request, ctx),
    ).toMatchObject({ times: ['09:00'] })
    expect(deps.catalog).toHaveBeenCalledTimes(1)
    expect(deps.slots.mock.calls[0][0]).toMatchObject({ requiredMinutes: 120 })
    expect(
      await runPhoneTool('phone_quoted_openings', request, {
        ...ctx,
        callSid: 'different',
      }),
    ).toHaveProperty('error')
    expect(
      await runPhoneTool(
        'phone_quoted_openings',
        { ...request, quote_ref: q.quote_ref.replace('120.', '240.') },
        ctx,
      ),
    ).toHaveProperty('error')
    expect(deps.slots).toHaveBeenCalledTimes(1)
  })
  it('only trusts an opening after all earlier dates in its batch were checked', async () => {
    const request = {
      visit_type: slot.visit_type,
      zip_code: slot.zip_code,
      search_from: slot.appointment_date,
      service,
    }
    deps.slots.mockRejectedValueOnce(Error('calendar unavailable'))
    expect(await runPhoneTool('phone_openings', request, ctx)).toHaveProperty(
      'error',
    )
    deps.slots
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ start_time: '11:00:00' }])
      .mockRejectedValueOnce(Error('later day unavailable'))
    expect(await runPhoneTool('phone_openings', request, ctx)).toMatchObject({
      date: '2099-07-02',
      times: ['11:00'],
    })
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

it('converts private catalog codes to real service IDs in quote, availability, and booking inputs', async () => {
  const { previewPhoneTools } = await import('./engine')
  const item = {
    id,
    slug: 'love-seat',
    name: 'Love Seat',
    category: 'Upholstery',
    pricing_unit: 'fixed',
    base_price: 100,
  }
  const tools = previewPhoneTools([item])
  const lines = {
    ...service,
    line_items: [{ service_id: 'love-seat', quantity: 1 }],
  }
  for (const [name, args] of [
    ['phone_quote', lines],
    ['phone_openings', { ...slot, service: lines }],
    ['phone_preview_booking', { ...booking, service: lines }],
  ] as const) {
    const schema = tools.find((t) => t.name === name)!.inputSchema
    expect(JSON.stringify(z.toJSONSchema(schema))).toContain('love-seat')
    const parsed = schema.parse(args)
    expect(JSON.stringify(parsed)).toContain(id)
    expect(JSON.stringify(parsed)).not.toContain('love-seat')
  }
  expect(
    phoneTools
      .find((t) => t.name === 'phone_quote')!
      .inputSchema.safeParse(lines).success,
  ).toBe(false)
  const duplicated = previewPhoneTools([
    item,
    { ...item, id: '67420f5e-4ea3-4bea-b8ba-80e385cc8f93' },
  ])
  expect(
    duplicated
      .find((t) => t.name === 'phone_quote')!
      .inputSchema.safeParse(lines).success,
  ).toBe(false)
})
