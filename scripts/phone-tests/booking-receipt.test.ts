// @vitest-environment node
import OpenAI from 'openai'
import { handleLiveIncoming } from '@/app/api/phone-assistant/incoming/live'
import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/phone-assistant/tools/route'
import { recognizePhoneCaller } from '@/lib/phone-assistant/caller'
import { issueCallToken } from '@/lib/phone-assistant/call-token'
import { getVoiceSession } from '@/lib/phone-assistant/records'
import {
  buildVoiceSummaryEmail,
  summarizeVoiceCall,
} from '@/lib/phone-assistant/summary-email'

const deps = vi.hoisted(() => ({
  db: vi.fn(),
  openSlots: vi.fn(),
  staffSlots: vi.fn(),
  measurementSlots: vi.fn(),
  after: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: deps.db }))
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: deps.after,
}))
vi.mock('@/lib/ops/staff-availability', async (original) => ({
  ...(await original<typeof import('@/lib/ops/staff-availability')>()),
  getUnionedSlots: deps.openSlots,
  getAllStaffSlots: deps.staffSlots,
  getStaffPrioritizedSlots: deps.measurementSlots,
}))
vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateText: async () => ({
    output: {
      topic: 'Scheduling',
      bookingRequestedOrPromised: true,
      excerpts: [{ role: 'user', quote: 'Three rooms and one sofa' }],
    },
  }),
}))

const sid = 'CA' + 'a'.repeat(32)
const appointmentId = 'deed0001-0000-4000-b000-000000000001'
const staffId = 'deed0002-0000-4000-b000-000000000002'
const appointmentDate = '2099-11-24'
const catalog = [
  {
    id: 'deed0003-0000-4000-b000-000000000003',
    slug: 'regular-size-room',
    name: 'Regular Size Room',
    base_price: 46,
    category: 'Carpet Cleaning',
    pricing_unit: 'room',
  },
  {
    id: 'deed0004-0000-4000-b000-000000000004',
    slug: 'urine-eliminator',
    name: 'Urine Eliminator Treatment',
    base_price: 30,
    category: 'Carpet Cleaning',
    pricing_unit: 'room',
  },
  {
    id: 'deed0005-0000-4000-b000-000000000005',
    slug: 'sofa-couch-3-seat',
    name: 'Sofa / Couch 3 Seat',
    base_price: 150,
    category: 'Upholstery Cleaning',
    pricing_unit: 'sofa',
  },
  {
    id: 'deed0006-0000-4000-b000-000000000006',
    slug: 'sasquatch-size-room-200-to-400-sqft',
    name: 'Sasquatch Size Room (200 to 400 Sqft)',
    base_price: 65,
    category: 'Carpet Cleaning',
    pricing_unit: 'room',
  },
  {
    id: 'deed0007-0000-4000-b000-000000000007',
    slug: 'loveseat',
    name: 'Loveseat',
    base_price: 135,
    category: 'Upholstery Cleaning',
    pricing_unit: 'loveseat',
  },
]
const service = {
  zip_code: '80132',
  lead_source: 'referral',
  lead_detail: 'Neighbor',
  line_items: catalog.slice(0, 3).map((item, index) => ({
    service_id: item.id,
    quantity: index === 2 ? 1 : 3,
  })),
}
const accepted = {
  visit_type: 'residential_service',
  appointment_date: appointmentDate,
  start_time: '15:00',
  zip_code: service.zip_code,
  first_name: 'Jamie',
  last_name: 'Tester',
  email: 'jamie@example.com',
  street: '1 Example Court',
  city: 'Monument',
  service,
  customer_confirmed: true,
  email_confirmed: true,
  accepted_minimum_charge: false,
  confirmed_total: 378,
}

// The HTTP transport, tool registration, quote, planning, commit wrapper, receipt replay,
// call reads and recap are real. Only external dependencies and the SQL boundary are local.
function isolatedCall(pilot = false) {
  const session = {
    call_sid: sid,
    caller_phone: '+13035550141',
    pilot,
    provider_call_id: 'live_test',
    started_at: new Date().toISOString(),
    answered_at: new Date().toISOString(),
    ended_at: null as string | null,
    summary: null,
  }
  const transcript = [
    {
      sequence: 1,
      role: 'user',
      content: 'Three rooms and one sofa, and urine treatment in each room.',
    },
    { sequence: 2, role: 'assistant', content: 'Do you confirm?' },
    { sequence: 3, role: 'user', content: 'Yes.' },
    {
      sequence: 4,
      role: 'assistant',
      content: "I'll finalize that now and make sure everything matches.",
    },
  ]
  const customers: Record<string, unknown>[] = []
  const addresses: Record<string, unknown>[] = []
  const measurementPlans: Record<string, unknown>[] = []
  const appointments: Record<string, unknown>[] = []
  const history: {
    appointment_date: string
    customer_id: string
    service_address_id: string
    status: string
    kind: string
    parked_at: string | null
  }[] = []
  let historyReads = 0
  const invoices: Record<string, unknown>[] = []
  const fail = { commit: false }
  const db = createClient('https://phone-fixture.invalid', 'fixture', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        const resource = url.pathname.replace('/rest/v1/', '')
        if (
          request.method === 'POST' &&
          resource === 'rpc/bind_phone_assistant_provider'
        ) {
          const binding = await request.json()
          expect(binding.p_sid).toBe(session.call_sid)
          session.provider_call_id = binding.p_provider_id
          return Response.json(true)
        }
        if (
          request.method === 'POST' &&
          resource === 'rpc/mark_phone_assistant_answered'
        ) {
          const binding = await request.json()
          expect(binding.p_provider_id).toBe(session.provider_call_id)
          session.answered_at = new Date().toISOString()
          return Response.json(true)
        }
        if (
          request.method === 'POST' &&
          resource === 'rpc/is_phone_blacklisted'
        )
          return Response.json(false)
        if (
          request.method === 'POST' &&
          resource === 'rpc/phone_booking_calendar_version'
        )
          return Response.json('calendar-version')
        if (
          request.method === 'POST' &&
          resource === 'rpc/create_phone_measurement'
        ) {
          const { p_sid, p_hash, p_version, p_plan } = await request.json()
          measurementPlans.push(p_plan)
          expect(p_sid).toBe(sid)
          expect(p_version).toBe('calendar-version')
          expect(p_plan).toMatchObject({
            expected_caller_sequence: transcript
              .filter((turn) => turn.role === 'user')
              .at(-1)?.sequence,
            date: appointmentDate,
            time: '15:00',
            customer: { business_name: 'Example Office' },
            staff_id: staffId,
          })
          appointments.push({
            id: appointmentId,
            kind: 'estimate',
            status: 'confirmed',
            parked_at: null,
            appointment_date: p_plan.date,
            start_time: p_plan.time,
            phone_assistant_call_sid: p_sid,
            phone_assistant_request_hash: p_hash,
          })
          return Response.json({
            status: 'booked',
            appointment_id: appointmentId,
            confirmation_number: 'EST-DEED0001',
            date: p_plan.date,
            time: p_plan.time,
          })
        }
        if (
          request.method === 'POST' &&
          resource === 'rpc/save_phone_booking'
        ) {
          if (fail.commit)
            return Response.json(
              { message: 'Slot is already taken', code: 'P0001' },
              { status: 400 },
            )
          const { p_sid, p_hash, p_plan } = await request.json()
          expect(p_sid).toBe(session.call_sid)
          expect(p_hash).toMatch(/^[a-f0-9]{64}$/)
          expect(p_plan).toMatchObject({
            customer: { phone: session.caller_phone, email: accepted.email },
            address: { street_1: accepted.street, zip_code: service.zip_code },
            expected_caller_sequence: transcript
              .filter((turn) => turn.role === 'user')
              .at(-1)?.sequence,
            calendar_version: 'calendar-version',
            appointment_status: 'booked',
            subtotal: 378,
            total: 378,
            start_time: '15:00',
            end_time: '18:00',
            line_items: service.line_items.map((line) => ({
              service_catalog_item_id: line.service_id,
              quantity: line.quantity,
            })),
          })
          appointments.push({
            id: appointmentId,
            customer_id: p_plan.verified_customer_id,
            service_address_id: p_plan.verified_service_address_id,
            status: p_plan.appointment_status,
            appointment_date: p_plan.appointment_date,
            start_time: p_plan.start_time,
            phone_assistant_call_sid: p_sid,
            phone_assistant_request_hash: p_hash,
            quoted_total: p_plan.total,
            parked_at: null,
          })
          invoices.push({
            appointment_id: appointmentId,
            status: 'draft',
            total: p_plan.total,
          })
          return Response.json({
            appointment_id: appointmentId,
            appointment_status: p_plan.appointment_status,
            appointment_date: p_plan.appointment_date,
            start_time: p_plan.start_time,
            invoice_id: 'synthetic-invoice',
            customer_id: p_plan.verified_customer_id ?? 'synthetic-customer',
            address_id:
              p_plan.verified_service_address_id ?? 'synthetic-address',
            total: p_plan.total,
            subtotal: p_plan.subtotal,
            discount_applied: 0,
          })
        }
        if (request.method !== 'GET')
          throw Error('Unexpected fixture write: ' + resource)
        let rows: unknown[]
        switch (resource) {
          case 'phone_assistant_sessions':
            rows =
              url.searchParams.get('call_sid') === 'eq.' + sid ? [session] : []
            break
          case 'phone_assistant_transcript':
            rows =
              url.searchParams.get('role') === 'eq.user'
                ? transcript.filter((turn) => turn.role === 'user').slice(-1)
                : transcript
            break
          case 'ops_appointments':
            if (url.searchParams.has('customer_id')) {
              historyReads++
              const selected = (field: string, id: string) =>
                (url.searchParams.get(field) || '')
                  .replace(/^in\.\((.*)\)$/, '$1')
                  .split(',')
                  .includes(id)
              rows = history.filter(
                (job) =>
                  (!url.searchParams.has('service_address_id') ||
                    selected('service_address_id', job.service_address_id)) &&
                  (!url.searchParams.has('appointment_date') ||
                    job.appointment_date <=
                      (url.searchParams.get('appointment_date') || '').slice(
                        4,
                      )) &&
                  selected('customer_id', job.customer_id) &&
                  url.searchParams.get('status') === 'eq.' + job.status &&
                  url.searchParams.get('parked_at') === 'is.null' &&
                  job.parked_at === null &&
                  url.searchParams.get('kind') === 'eq.' + job.kind,
              )
              if (
                url.searchParams.get('order')?.includes('appointment_date.desc')
              ) {
                rows = (rows as typeof history).sort((left, right) =>
                  right.appointment_date.localeCompare(left.appointment_date),
                )
                rows = rows.slice(
                  0,
                  Number(url.searchParams.get('limit') || rows.length),
                )
              }
              break
            }
            rows = appointments.filter(
              (a) =>
                url.searchParams.get('phone_assistant_call_sid') ===
                'eq.' + a.phone_assistant_call_sid,
            )
            break
          case 'service_catalog_items':
            rows = catalog
            break
          case 'staff_users':
            rows = [{ display_name: 'Test technician' }]
            break
          case 'ops_customers':
            rows = customers
            break
          case 'ops_service_addresses':
            rows = addresses
            break
          case 'lead_source_options':
          case 'settings':
            rows = []
            break
          default:
            throw Error('Unexpected fixture read: ' + resource)
        }
        return Response.json(rows)
      },
    },
  })
  deps.db.mockReturnValue(db)
  return {
    db,
    session,
    history,
    historyReads: () => historyReads,
    transcript,
    appointments,
    invoices,
    fail,
    customers,
    addresses,
    measurementPlans,
  }
}
// The same CRM customer owns conflicting city variants. Only one has a completed cleaning.
function returningCallerWithHistory() {
  const fixture = isolatedCall()
  const customer = {
    id: 'a0c5b218-ec8d-44fd-9cef-a752f40ae54b',
    first_name: accepted.first_name,
    last_name: accepted.last_name,
    full_name: accepted.first_name + ' ' + accepted.last_name,
    phone: fixture.session.caller_phone,
    email: accepted.email,
    business_name: null,
    is_commercial: false,
  }
  const other = { ...customer, id: '0b592361-cb75-4c86-93a2-c9f3b9450807' }
  const site = {
    id: '17a7532e-5829-4874-b828-0c137308c237',
    customer_id: customer.id,
    street_1: accepted.street,
    city: accepted.city,
    state: 'CO',
    zip_code: accepted.zip_code,
  }
  const imported = {
    ...site,
    id: 'c7dfad7f-c05a-4cbe-a71f-1569ba2bfc04',
    customer_id: customer.id,
    street_1: '1 Example Ct.',
    city: 'Palmer Lake',
  }
  fixture.customers.push(customer)
  fixture.addresses.push(imported, site)
  const completed = {
    appointment_date: '2025-02-01',
    customer_id: customer.id,
    service_address_id: site.id,
    status: 'completed',
    kind: 'service',
    parked_at: null,
  }
  fixture.history.push(
    completed,
    { ...completed, service_address_id: imported.id, status: 'cancelled' },
    { ...completed, service_address_id: imported.id, kind: 'estimate' },
    {
      ...completed,
      service_address_id: imported.id,
      parked_at: '2026-01-15T00:00:00Z',
    },
  )
  const request = { first_name: customer.first_name, street: '1 Example Ct.' }
  return { fixture, customer, other, site, imported, completed, request }
}
async function mcp(method: string, params: object) {
  const result = await POST(
    new Request('https://phone-fixture.invalid/api/phone-assistant/tools', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + issueCallToken(sid, 'tools'),
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  )
  expect(result.status).toBe(200)
  const packet = await result.text()
  const data = packet.split('\n').find((line) => line.startsWith('data:'))
  const response = JSON.parse(data ? data.slice(5) : packet)
  expect(response.error).toBeUndefined()
  return response.result
}
async function call(name: string, args: object) {
  const result = await mcp('tools/call', { name, arguments: args })
  if (result.isError) return { error: result.content[0].text }
  return JSON.parse(result.content[0].text)
}
async function ownerEmail(fixture: ReturnType<typeof isolatedCall>) {
  fixture.session.ended_at = new Date().toISOString()
  const ended = await getVoiceSession(sid, fixture.db)
  if (!ended) throw Error('Missing ended fixture session')
  return buildVoiceSummaryEmail(
    ended,
    await summarizeVoiceCall(ended, fixture.db),
  )
}
beforeEach(() => {
  vi.stubEnv('HARRY_VOICE_WEBHOOK_SECRET', 'synthetic-only')
  deps.after.mockReset()
  deps.measurementSlots.mockReset()
  deps.openSlots.mockReset().mockResolvedValue([{ start_time: '15:00:00' }])
  deps.staffSlots
    .mockReset()
    .mockResolvedValue([
      { staffUserId: staffId, slots: [{ start_time: '15:00:00' }] },
    ])
  // Unstubbed external HTTP must fail in this test even on a developer machine with credentials.
  vi.stubGlobal('fetch', () => {
    throw Error('External HTTP disabled for synthetic calls')
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
describe('phone transport through booking and owner recap', () => {
  it.each([true, false])(
    'gives the voice provider the allowed MCP tools for a private or public call (pilot %s)',
    async (pilot) => {
      isolatedCall(pilot)
      const base = 'https://phone-fixture.invalid'
      vi.stubEnv('TWILIO_WEBHOOK_BASE_URL', base)
      vi.stubEnv('VERCEL_ENV', 'production')
      const acceptedConfigs: { name: string; tools: string[] }[] = []
      const provider = new OpenAI({
        apiKey: 'fixture',
        maxRetries: 0,
        fetch: async (input, init) => {
          const request = new Request(input, init)
          expect(new URL(request.url).pathname).toBe(
            '/v1/live/sessions/live_fixture/accept',
          )
          const { session } = await request.json()
          const offered = session.delegation.responses.tools[0]
          expect(offered.server_url).toBe(base + '/api/phone-assistant/tools')
          acceptedConfigs.push({
            name: session.model,
            tools: offered.allowed_tools,
          })
          return new Response(null, { status: 204 })
        },
      })
      const response = await handleLiveIncoming(
        {
          id: 'evt_fixture',
          type: 'live.transport.incoming',
          data: {
            type: 'sip',
            session_id: 'live_fixture',
            sip_headers: [
              {
                name: 'X-Sightings-Live-Invite',
                value: issueCallToken(
                  sid,
                  ('live-invite:' + base) as `live-invite:${string}`,
                ),
              },
            ],
          },
        },
        base + '/api/phone-assistant/incoming',
        provider,
      )
      expect(response.status).toBe(204)
      expect(acceptedConfigs).toHaveLength(1)
      const registered = (await mcp('tools/list', {})).tools.map(
        (t: { name: string }) => t.name,
      )
      const allowed = acceptedConfigs[0].tools
      expect(allowed).toEqual(
        expect.arrayContaining(
          pilot
            ? ['phone_preview_booking']
            : ['phone_book_service', 'phone_book_measurement'],
        ),
      )
      expect(allowed).not.toContain(
        pilot ? 'phone_book_service' : 'phone_preview_booking',
      )
      for (const offered of allowed) expect(registered).toContain(offered)
    },
  )
  // November 19 pricing fixture: a couch plus a 350 sq ft room; the second
  // caller corrects “couch” to “loveseat” before asking for the first opening.
  it.each([
    [2, 215],
    [4, 200],
  ])(
    'prices the complete corrected job before offering an opening (catalog index %i)',
    async (seatingIndex, total) => {
      const fixture = isolatedCall()
      const selected = [catalog[seatingIndex], catalog[3]]
      deps.openSlots.mockResolvedValueOnce([])
      const available = await call('phone_openings', {
        visit_type: 'residential_service',
        zip_code: '80133',
        search_from: appointmentDate,
        service: {
          zip_code: '80133',
          line_items: selected.map((s) => ({ service_id: s.id, quantity: 1 })),
        },
      })
      expect(available).toMatchObject({
        date: '2099-11-25',
        times: ['15:00'],
        quote: {
          total,
          lines: selected.map((s) => ({
            name: s.name,
            quantity: 1,
            unit_price: s.base_price,
          })),
        },
      })
      expect(fixture.appointments).toHaveLength(0)
    },
  )
  it('books a returning residential caller on the verified profile and site without asking for the saved email', async () => {
    const fixture = isolatedCall()
    const profile = {
      id: '09eaa7bc-8436-4cb2-be7d-c00ab0782eed',
      first_name: accepted.first_name,
      last_name: accepted.last_name,
      email: accepted.email,
      phone: fixture.session.caller_phone,
    }
    const site = {
      id: '17a7532e-5829-4874-b828-0c137308c237',
      customer_id: profile.id,
      street_1: accepted.street,
      city: accepted.city,
      state: 'CO',
      zip_code: accepted.zip_code,
    }
    const otherId = '0b592361-cb75-4c86-93a2-c9f3b9450807'
    fixture.customers.push(
      {
        ...profile,
        id: 'a0c5b218-ec8d-44fd-9cef-a752f40ae54b',
        first_name: 'Other',
      },
      profile,
      { ...profile, id: otherId },
    )
    fixture.addresses.push(site, {
      ...site,
      id: 'c7dfad7f-c05a-4cbe-a71f-1569ba2bfc04',
      customer_id: otherId,
    })
    const match = await call('phone_caller_lookup', {
      first_name: accepted.first_name,
      last_name: accepted.last_name,
      street: '1 Example Ct.',
    })
    expect(match).toMatchObject({
      status: 'verified_location',
      saved_email_available: true,
      customer_ref: profile.id,
      service_address_ref: site.id,
    })
    expect(JSON.stringify(match)).not.toContain(accepted.email)
    const receipt = await call('phone_book_service', {
      ...accepted,
      email: undefined,
      use_saved_email: true,
      customer_ref: match.customer_ref,
      service_address_ref: match.service_address_ref,
    })
    expect(receipt).toMatchObject({
      status: 'booked',
      date: appointmentDate,
    })
    expect(fixture.appointments).toMatchObject([
      { customer_id: profile.id, service_address_id: site.id },
    ])
  })
  it('offers only the usual saved street after a name confirmation, then books the accepted address without restatement', async () => {
    const { fixture, customer, site } = returningCallerWithHistory()
    fixture.transcript.splice(
      0,
      fixture.transcript.length,
      { sequence: 1, role: 'assistant', content: 'Is this Jamie?' },
      { sequence: 2, role: 'user', content: 'Yes.' },
    )
    expect(
      await recognizePhoneCaller(
        fixture.session.caller_phone,
        fixture.db,
        AbortSignal.timeout(1000),
      ),
    ).toMatchObject({ firstName: customer.first_name })
    const offer = await call('phone_usual_address', {
      first_name: customer.first_name,
      first_name_confirmed: true,
    })
    expect(offer).toMatchObject({
      status: 'confirm_saved_street',
      street: site.street_1,
    })
    expect(
      Object.keys(offer).filter(
        (k) =>
          ![
            'status',
            'street',
            'unit',
            'city',
            'zip_code',
            'guidance',
          ].includes(k),
      ),
    ).toEqual([])
    if (offer.city) expect(offer.city).toBe(site.city)
    if (offer.zip_code) expect(offer.zip_code).toBe(site.zip_code)
    for (const secret of [customer.email, customer.id, site.id])
      expect(JSON.stringify(offer)).not.toContain(secret)
    const request = { first_name: customer.first_name, street: offer.street }
    fixture.transcript.push(
      {
        sequence: 3,
        role: 'assistant',
        content: 'Still at ' + offer.street + '?',
      },
      { sequence: 4, role: 'user', content: 'Yes.' },
    )
    const match = await call('phone_caller_lookup', {
      ...request,
      city: offer.city,
      zip_code: offer.zip_code,
    })
    expect(await call('phone_caller_lookup', request)).toEqual(match)
    expect(match).toMatchObject({
      status: 'verified_location',
      customer_ref: customer.id,
      service_address_ref: site.id,
      city: site.city,
      zip_code: site.zip_code,
      saved_email_available: true,
    })
    expect(JSON.stringify(match)).not.toContain(customer.email)
    expect(fixture.historyReads()).toBeGreaterThan(0)
    const book = {
      ...request,
      visit_type: accepted.visit_type,
      appointment_date: accepted.appointment_date,
      start_time: accepted.start_time,
      service: { ...accepted.service, zip_code: match.zip_code },
      confirmed_total: accepted.confirmed_total,
      customer_confirmed: true,
      email_confirmed: true,
      accepted_minimum_charge: false,
      use_saved_email: true,
      customer_ref: match.customer_ref,
      service_address_ref: match.service_address_ref,
    }
    fixture.transcript.push(
      {
        sequence: 5,
        role: 'assistant',
        content: 'Confirm the quoted visit and use your email on file?',
      },
      { sequence: 6, role: 'user', content: 'Yes, please book it.' },
    )
    expect(
      fixture.transcript
        .filter((turn) => turn.role === 'user')
        .map((turn) => turn.content),
    ).toEqual(['Yes.', 'Yes.', 'Yes, please book it.'])
    const receipt = await call('phone_book_service', book)
    expect(receipt).toMatchObject({
      status: 'booked',
      date: appointmentDate,
    })
    expect(await call('phone_book_service', book)).toEqual(receipt)
    expect(fixture.appointments).toMatchObject([
      { customer_id: customer.id, service_address_id: site.id },
    ])
    expect(fixture.invoices).toHaveLength(1)
    expect(fixture.customers).toHaveLength(1)
    expect(fixture.addresses).toHaveLength(2)
  })
  it('discards a rejected street offer and withholds the old references when the caller gives a new address', async () => {
    const { fixture, customer, site } = returningCallerWithHistory()
    const offered = await call('phone_usual_address', {
      first_name: customer.first_name,
      first_name_confirmed: true,
    })
    expect(offered).toMatchObject({
      status: 'confirm_saved_street',
      street: site.street_1,
    })
    const corrected = {
      first_name: customer.first_name,
      street: '72 New Place',
    }
    fixture.transcript.push({
      sequence: 5,
      role: 'user',
      content: 'No, this visit is at 72 New Place.',
    })
    const match = await call('phone_caller_lookup', corrected)
    expect(match.status).toBe('no_verified_location')
    expect(match).not.toHaveProperty('service_address_ref')
    expect(match).not.toHaveProperty('customer_ref')
    expect(fixture.appointments).toHaveLength(0)
  })
  it('offers the most recent completed service street and omits all other contact details', async () => {
    const { fixture, customer, site, imported, completed } =
      returningCallerWithHistory()
    imported.street_1 = '24 Other Court'
    fixture.history.push(
      {
        ...completed,
        service_address_id: imported.id,
        appointment_date: '2024-07-15',
      },
      {
        ...completed,
        service_address_id: imported.id,
        appointment_date: '2099-07-15',
      },
    )
    const offer = await call('phone_usual_address', {
      first_name: customer.first_name,
      first_name_confirmed: true,
    })
    expect(offer).toMatchObject({
      status: 'confirm_saved_street',
      street: site.street_1,
    })
    for (const field of [
      'email',
      'customer_ref',
      'service_address_ref',
      'city',
      'zip_code',
    ])
      expect(offer).not.toHaveProperty(field)
    for (const value of [
      customer.id,
      site.id,
      customer.email,
      imported.street_1,
    ])
      expect(JSON.stringify(offer)).not.toContain(value)
    expect(fixture.appointments).toHaveLength(0)
  })
  it.each([
    'wrong first name',
    'shared email destinations',
    'two most recent sites',
    'no name confirmation',
    'declined name confirmation',
  ] as const)('withholds the saved-street offer for %s', async (reason) => {
    const { fixture, customer, other, site, imported, completed } =
      returningCallerWithHistory()
    if (reason === 'shared email destinations')
      fixture.customers.push({ ...other, email: 'second@example.test' })
    if (reason === 'two most recent sites') {
      imported.street_1 = '24 Other Court'
      fixture.history.push({ ...completed, service_address_id: imported.id })
    }
    const result = await call('phone_usual_address', {
      first_name:
        reason === 'wrong first name' ? 'Someone' : customer.first_name,
      ...(reason !== 'no name confirmation' && {
        first_name_confirmed: reason !== 'declined name confirmation',
      }),
    })
    if (
      reason === 'no name confirmation' ||
      reason === 'declined name confirmation'
    )
      expect(
        result.status === 'ask_for_street' || typeof result.error === 'string',
      ).toBe(true)
    else expect(result).toMatchObject({ status: 'ask_for_street' })
    expect(result).not.toHaveProperty('street')
    for (const secret of [
      customer.email,
      customer.id,
      site.street_1,
      imported.street_1,
      site.id,
      imported.id,
      site.city,
      site.zip_code,
    ])
      expect(JSON.stringify(result)).not.toContain(secret)
    expect(fixture.appointments).toHaveLength(0)
    expect(fixture.invoices).toHaveLength(0)
  })
  it.each(['different surnames', 'two completed sites'] as const)(
    'requests only the necessary detail and withholds references for %s',
    async (reason) => {
      const { fixture, customer, other, site, imported, completed, request } =
        returningCallerWithHistory()
      if (reason === 'different surnames') {
        fixture.customers.push(other)
        imported.customer_id = other.id
        other.last_name = 'Another'
        other.full_name = other.first_name + ' ' + other.last_name
        expect(
          await recognizePhoneCaller(
            fixture.session.caller_phone,
            fixture.db,
            AbortSignal.timeout(1000),
          ),
        ).toMatchObject({ firstName: null })
      } else {
        fixture.history.push({
          ...completed,
          customer_id: customer.id,
          service_address_id: imported.id,
        })
      }
      const match = await call('phone_caller_lookup', request)
      expect(match).toMatchObject(
        reason === 'different surnames'
          ? { status: 'needs_name_confirmation' }
          : { status: 'needs_location_confirmation', missing_field: 'city' },
      )
      for (const sensitive of [
        customer.id,
        other.id,
        site.id,
        imported.id,
        customer.email,
        site.city,
        imported.city,
      ])
        expect(JSON.stringify(match)).not.toContain(sensitive)
      expect(match).not.toHaveProperty('customer_ref')
      expect(match).not.toHaveProperty('service_address_ref')
      if (reason === 'different surnames')
        expect(fixture.historyReads()).toBe(0)
      const unsafe = await call('phone_book_service', {
        ...accepted,
        last_name: undefined,
        city: undefined,
        zip_code: undefined,
        email: undefined,
        ...request,
        customer_ref: customer.id,
        service_address_ref: site.id,
        use_saved_email: true,
      })
      expect(unsafe).toHaveProperty('error')
      expect(fixture.appointments).toHaveLength(0)
      expect(fixture.invoices).toHaveLength(0)
    },
  )
  it('turns the accepted quote into one schedule entry, invoice and verifiable receipt', async () => {
    const fixture = isolatedCall()
    const tools = (await mcp('tools/list', {})).tools.map(
      (t: { name: string }) => t.name,
    )
    expect(tools).toContain('phone_book_service')
    expect(tools).not.toContain('phone_preview_booking')
    expect(await call('phone_quote', service)).toMatchObject({ total: 378 })
    expect(
      await call('phone_openings', {
        visit_type: accepted.visit_type,
        appointment_date: accepted.appointment_date,
        zip_code: service.zip_code,
        service,
      }),
    ).toMatchObject({ date: appointmentDate, times: ['15:00'] })
    const receipt = await call('phone_book_service', accepted)
    expect(receipt).toEqual({
      status: 'booked',
      date: appointmentDate,
      time: '15:00',
      total: 378,
    })
    deps.openSlots.mockResolvedValue([])
    expect(await call('phone_book_service', accepted)).toEqual(receipt)
    expect(fixture.appointments).toHaveLength(1)
    expect(deps.after).toHaveBeenCalledTimes(1)
    expect(fixture.invoices).toEqual([
      { appointment_id: appointmentId, status: 'draft', total: 378 },
    ])
    const email = await ownerEmail(fixture)
    expect(email.subject).toContain('Booking verified')
    expect(email.text).toContain('SC-DEED0001')
  })
  it.each([false, true])(
    'books and replays a commercial measuring visit without a residential invoice (returning %s)',
    async (returning) => {
      const fixture = isolatedCall()
      deps.measurementSlots.mockResolvedValue({
        staffUserId: staffId,
        slots: [{ start_time: '15:00:00' }],
      })
      const business = {
        id: '12345678-0000-4000-8000-000000000001',
        first_name: accepted.first_name,
        last_name: accepted.last_name,
        email: accepted.email,
        business_name: 'Example Office',
        is_commercial: true,
        phone: fixture.session.caller_phone,
      }
      const siteId = '12345678-0000-4000-8000-000000000002'
      let refs = {}
      if (returning) {
        fixture.customers.push(business)
        fixture.addresses.push({
          id: siteId,
          customer_id: business.id,
          street_1: accepted.street,
          street_2: null,
          city: accepted.city,
          state: 'CO',
          zip_code: accepted.zip_code,
        })
        const match = await call('phone_caller_lookup', {
          first_name: accepted.first_name,
          last_name: accepted.last_name,
          business_name: business.business_name,
          street: accepted.street,
        })
        expect(match).toMatchObject({
          status: 'verified_location',
          customer_ref: business.id,
          service_address_ref: siteId,
          saved_email_available: true,
        })
        expect(JSON.stringify(match)).not.toContain(accepted.email)
        refs = {
          customer_ref: match.customer_ref,
          service_address_ref: match.service_address_ref,
          use_saved_email: true,
        }
      }
      const measurement = {
        visit_type: 'commercial_measurement',
        business_name: 'Example Office',
        job_description: 'Measure office carpeting.',
        appointment_date: appointmentDate,
        start_time: '15:00',
        first_name: accepted.first_name,
        last_name: accepted.last_name,
        ...(returning ? refs : { email: accepted.email }),
        email_confirmed: true,
        street: accepted.street,
        city: accepted.city,
        zip_code: accepted.zip_code,
        customer_confirmed: true,
      }
      const receipt = await call('phone_book_measurement', measurement)
      expect(receipt).toEqual({
        status: 'booked',
        date: appointmentDate,
        time: measurement.start_time,
      })
      if (returning) {
        expect(fixture.measurementPlans[0]).toMatchObject({
          saved_contact: {
            customer_id: business.id,
            address_id: siteId,
            use_saved_email: true,
          },
          customer: { email: accepted.email },
        })
      }
      deps.measurementSlots.mockResolvedValue(null)
      expect(await call('phone_book_measurement', measurement)).toEqual(receipt)
      expect(deps.measurementSlots).toHaveBeenCalledTimes(1)
      expect(fixture.appointments).toHaveLength(1)
      expect(fixture.invoices).toHaveLength(0)
      const email = await ownerEmail(fixture)
      expect(email.subject).toContain('Measuring visit verified')
      expect(email.text).toContain('commercial measuring visit EST-DEED0001')
    },
  )
  it('flags the accepted request for follow-up when saving fails after pricing and availability checks', async () => {
    const fixture = isolatedCall()
    fixture.fail.commit = true
    expect(await call('phone_book_service', accepted)).toHaveProperty('error')
    expect(fixture.appointments).toHaveLength(0)
    expect(deps.after).not.toHaveBeenCalled()
    expect(fixture.invoices).toHaveLength(0)
    const email = await ownerEmail(fixture)
    expect(email.subject).toContain('Follow-up needed')
    expect(email.text).toContain('No appointment is linked to this call.')
  })
  it('keeps a valid private simulation out of the real booking and email paths', async () => {
    const fixture = isolatedCall(true)
    const tools = (await mcp('tools/list', {})).tools.map(
      (t: { name: string }) => t.name,
    )
    expect(tools).toContain('phone_preview_booking')
    expect(tools).not.toContain('phone_book_service')
    expect(await call('phone_preview_booking', accepted)).toMatchObject({
      status: 'simulated',
      created: false,
    })
    expect(fixture.appointments).toHaveLength(0)
    expect(deps.after).not.toHaveBeenCalled()
    expect(fixture.invoices).toHaveLength(0)
    expect((await ownerEmail(fixture)).subject).toContain('Private preview')
  })
})
