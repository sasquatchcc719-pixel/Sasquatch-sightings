// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
const deps = vi.hoisted(() => ({
  db: vi.fn(),
  promo: vi.fn(),
  catalog: vi.fn(),
  book: vi.fn(),
  commit: vi.fn(),
  verifiedCaller: vi.fn(),
  measurement: vi.fn(),
  slots: vi.fn(),
  staffSlots: vi.fn(),
  estimateSlots: vi.fn(),
  session: vi.fn(),
}))
vi.mock('./caller', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./caller')>()),
  verifiedCallerLocation: deps.verifiedCaller,
}))
vi.mock('./commercial-measurement', () => ({
  bookPhoneMeasurement: deps.measurement,
}))
vi.mock('@/lib/ops/commit-planned-booking', () => ({
  commitPlannedBooking: deps.commit,
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
import { phoneTools, phoneToolsForCall, runPhoneTool } from './engine'
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
    expect(phoneTools).toHaveLength(8)
    for (const t of phoneTools)
      expect(z.toJSONSchema(t.inputSchema).type).toBe('object')
  })
  it('accepts unambiguous catalog slugs in live quote, openings, and booking tools', () => {
    const catalog = [
      {
        id,
        name: 'Room',
        category: 'Carpet',
        base_price: 46,
        pricing_unit: 'each',
        slug: 'regular-room',
      },
    ]
    const selected = {
      ...service,
      line_items: [{ service_id: 'regular-room', quantity: 3 }],
    }
    const registry = phoneToolsForCall(false, catalog)
    const parse = (name: string, input: unknown) =>
      registry.find((t) => t.name === name)!.inputSchema.parse(input)
    expect(parse('phone_quote', selected)).toMatchObject({
      line_items: [{ service_id: id }],
    })
    expect(
      parse('phone_openings', { ...slot, service: selected }),
    ).toMatchObject({ service: { line_items: [{ service_id: id }] } })
    expect(
      parse('phone_book_service', {
        ...booking,
        service: selected,
        email_confirmed: true,
        confirmed_total: 378,
      }),
    ).toMatchObject({ service: { line_items: [{ service_id: id }] } })
    const duplicate = phoneToolsForCall(false, [
      ...catalog,
      { ...catalog[0], id: '8fa3ee90-2ef6-4a7e-af0a-e67b5758f885' },
    ]).find((t) => t.name === 'phone_quote')!
    expect(duplicate.inputSchema.safeParse(selected).success).toBe(false)
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

describe('live residential phone booking', () => {
  const live = { ...ctx, preview: false }
  const treatment = '8fa3ee90-2ef6-4a7e-af0a-e67b5758f884'
  const sofa = '8fa3ee90-2ef6-4a7e-af0a-e67b5758f885'
  const agreed = {
    ...booking,
    start_time: '15:00',
    email_confirmed: true,
    confirmed_total: 378,
    service: {
      ...service,
      line_items: [
        { service_id: id, quantity: 3 },
        { service_id: treatment, quantity: 3 },
        { service_id: sofa, quantity: 1 },
      ],
    },
  }
  const receipt = {
    status: 'booked',
    appointment_id: id,
    confirmation_number: 'SC-8FA3EE90',
    appointment_date: booking.appointment_date,
    start_time: '15:00',
    total: 378,
  }
  const prior = vi.fn()
  beforeEach(() => {
    deps.db.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: 'calendar-version' }),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: prior }) }) }),
    })
    prior.mockResolvedValue({ data: null })
    deps.slots.mockResolvedValue([{ start_time: '15:00:00' }])
    deps.catalog.mockResolvedValue([
      { id, name: 'Regular Size Room', base_price: 46 },
      { id: treatment, name: 'Urine Eliminator Treatment', base_price: 30 },
      { id: sofa, name: 'Sofa / Couch 3 Seat', base_price: 150 },
    ])
    deps.book.mockResolvedValue({ ok: true, subtotal: 378, total: 378 })
    deps.commit.mockResolvedValue(receipt)
  })
  it('exposes the real write only to public calls and simulations only to private calls', () => {
    expect(phoneToolsForCall(false).map((t) => t.name)).toContain(
      'phone_book_service',
    )
    expect(phoneToolsForCall(false).map((t) => t.name)).not.toContain(
      'phone_preview_booking',
    )
    expect(phoneToolsForCall(true).map((t) => t.name)).not.toContain(
      'phone_book_service',
    )
  })
  it('requires a saved appointment receipt for the exact accepted job', async () => {
    const result = await runPhoneTool('phone_book_service', agreed, live)
    expect(result).toMatchObject({
      status: 'booked',
      appointment_id: id,
      confirmation_number: receipt.confirmation_number,
      total: 378,
    })
    expect(deps.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: expect.objectContaining({ phone: ctx.callerPhone }),
        line_items: agreed.service.line_items,
        notify_customer: true,
        notify_internal: true,
      }),
      expect.objectContaining({ total: 378 }),
      null,
      expect.objectContaining({
        callSid: ctx.callSid,
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    )
  })
  it.each([
    ['private test', agreed, ctx],
    ['unconfirmed total', { ...agreed, confirmed_total: 300 }, live],
    ['missing consent', { ...agreed, customer_confirmed: false }, live],
    ['unverified email', { ...agreed, email_confirmed: false }, live],
    ['missing email', { ...agreed, email: undefined }, live],
    ['unavailable slot', { ...agreed, start_time: '16:00' }, live],
    ['commercial', { ...agreed, visit_type: 'commercial_measurement' }, live],
  ])('cannot write during %s', async (_, args, context) => {
    expect(
      await runPhoneTool(
        'phone_book_service',
        args as typeof agreed,
        context as typeof live,
      ),
    ).toHaveProperty('error')
    expect(deps.commit).not.toHaveBeenCalled()
  })
  it.each([
    { ...receipt, status: 'simulated' },
    { ...receipt, appointment_id: null },
    { ...receipt, start_time: '16:00' },
    { ...receipt, confirmation_number: null },
  ])('does not confirm a missing or mismatched receipt', async (invalid) => {
    deps.commit.mockResolvedValue(invalid)
    expect(
      await runPhoneTool('phone_book_service', agreed, live),
    ).toHaveProperty('error')
  })
  it('recovers an exact retry after the opening disappears and rejects a different job on the same call', async () => {
    await runPhoneTool('phone_book_service', agreed, live)
    const { requestHash } = deps.commit.mock.calls[0][3]
    prior.mockResolvedValue({
      data: {
        id,
        status: 'booked',
        appointment_date: agreed.appointment_date,
        start_time: '15:00:00',
        quoted_total: 378,
        phone_assistant_request_hash: requestHash,
      },
    })
    deps.slots.mockResolvedValue([])
    expect(
      await runPhoneTool('phone_book_service', agreed, live),
    ).toMatchObject({ status: 'booked', appointment_id: id })
    expect(
      await runPhoneTool(
        'phone_book_service',
        { ...agreed, street: 'A different address' },
        live,
      ),
    ).toHaveProperty('error')
    expect(deps.commit).toHaveBeenCalledTimes(1)
  })
  it('reuses a verified repeat contact and ZIP internally without exposing stored email', async () => {
    const a = '31d29174-a3e6-4567-8714-d2ccd3f89108'
    deps.verifiedCaller.mockResolvedValue({
      customer: {
        id,
        first_name: agreed.first_name,
        last_name: agreed.last_name,
        email: 'private@example.org',
      },
      address: {
        id: a,
        zip_code: service.zip_code,
        street_1: agreed.street,
        street_2: null,
        city: agreed.city,
      },
    })
    const repeat = {
      ...agreed,
      service: { ...agreed.service, lead_source: undefined, zip_code: '11111' },
      zip_code: '11111',
      customer_ref: id,
      service_address_ref: a,
      email: undefined,
      use_saved_email: true,
    }
    expect(
      await runPhoneTool('phone_book_service', repeat, live),
    ).toMatchObject({ status: 'booked' })
    expect(deps.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_source: 'repeat_customer',
        address: expect.objectContaining({ zip_code: service.zip_code }),
        customer: expect.objectContaining({ email: 'private@example.org' }),
      }),
      expect.anything(),
      null,
      expect.objectContaining({
        verifiedCustomerId: id,
        verifiedServiceAddressId: a,
        useSavedEmail: true,
      }),
    )
    deps.commit.mockClear()
    expect(
      await runPhoneTool(
        'phone_book_service',
        { ...repeat, service_address_ref: id },
        live,
      ),
    ).toHaveProperty('error')
    expect(
      await runPhoneTool(
        'phone_book_service',
        { ...repeat, use_saved_email: false },
        live,
      ),
    ).toHaveProperty('error')
    expect(deps.commit).not.toHaveBeenCalled()
  })
  it('discards an interrupted residential request before the transaction', async () => {
    expect(
      await runPhoneTool('phone_book_service', agreed, {
        ...live,
        isCurrent: async () => false,
      }),
    ).toHaveProperty('error')
    expect(deps.commit).not.toHaveBeenCalled()
  })
  it('sends a public commercial measuring visit through its dedicated adapter and excludes private calls', async () => {
    const measure = {
      ...agreed,
      visit_type: 'commercial_measurement',
      business_name: 'Example Business',
      job_description: 'Measure conference room',
      service: undefined,
    }
    deps.measurement.mockResolvedValue({
      status: 'booked',
      appointment_id: id,
      confirmation_number: 'EST-8FA3EE90',
      date: agreed.appointment_date,
      time: agreed.start_time,
    })
    expect(
      await runPhoneTool('phone_book_measurement', measure, live),
    ).toMatchObject({ status: 'booked', confirmation_number: 'EST-8FA3EE90' })
    expect(deps.measurement).toHaveBeenCalledWith(
      expect.objectContaining({
        callerPhone: ctx.callerPhone,
        callSid: ctx.callSid,
        businessName: 'Example Business',
        appointmentDate: agreed.appointment_date,
        startTime: agreed.start_time,
      }),
    )
    expect(
      await runPhoneTool('phone_book_measurement', measure, ctx),
    ).toHaveProperty('error')
    expect(deps.measurement).toHaveBeenCalledTimes(1)
    expect(deps.commit).not.toHaveBeenCalled()
  })
  it('returns an office handoff when a conflicting customer match prevents commitment', async () => {
    deps.commit.mockRejectedValue(
      new Error('Customer details require office review'),
    )
    expect(await runPhoneTool('phone_book_service', agreed, live)).toEqual({
      error: expect.stringMatching(/message/i),
    })
  })
})
