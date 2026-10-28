// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn() }))
vi.mock('@/supabase/server', () => ({
  createClient: mocks.session,
  createAdminClient: mocks.admin,
}))
import { POST } from './route'

const details = {
  client_name: ' Fixture Client ',
  client_phone: ' 7195550100 ',
  notes: ' Needs carpet cleaning ',
}
const request = (extra: Record<string, unknown> = {}) =>
  new NextRequest('https://example.test/api/partners/referrals', {
    method: 'POST',
    body: JSON.stringify({ ...details, ...extra }),
  })

let auth: { data: { user: { id: string; is_anonymous?: boolean } | null }; error: Error | null }
let partner: {
  data: { id: string; backlink_verified: boolean } | null
  error: Error | null
}
let referralError: { code: string; message: string } | null
let leadError: { message: string } | null
let filters: unknown[][]
let writes: unknown[][]

beforeEach(() => {
  vi.clearAllMocks()
  auth = { data: { user: { id: 'verified-user' } }, error: null }
  partner = {
    data: { id: 'saved-partner', backlink_verified: false },
    error: null,
  }
  referralError = null
  leadError = null
  filters = []
  writes = []
  const lookup = {
    select: vi.fn(() => lookup),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value])
      return lookup
    }),
    single: vi.fn(async () => partner),
  }
  mocks.session.mockResolvedValue({
    auth: { getUser: vi.fn(async () => auth) },
    from: vi.fn((table: string) => {
      expect(table).toBe('partners')
      return lookup
    }),
  })
  mocks.admin.mockReturnValue({
    from: (table: string) => {
      // Any access to balances, appointments, messages or other tables fails.
      expect(['referrals', 'leads']).toContain(table)
      const query = {
        insert: (value: unknown) => {
          writes.push([table, value])
          return query
        },
        select: () => query,
        single: async () => ({
          data: referralError ? null : { id: 'saved-referral' },
          error: referralError,
        }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ error: leadError }).then(resolve),
      }
      return query
    },
  })
})

describe('partner referral submission authority', () => {
  it.each(['missing', 'invalid', 'anonymous'])(
    'rejects a %s session before privileged work',
    async (kind) => {
      if (kind === 'missing') auth.data.user = null
      else if (kind === 'anonymous') auth.data.user = { id: 'temporary-user', is_anonymous: true }
      else auth.error = new Error('Invalid token')
      expect((await POST(request())).status).toBe(401)
      expect(mocks.admin).not.toHaveBeenCalled()
      expect(writes).toEqual([])
    },
  )

  it('requires the saved partner belonging to the verified user', async () => {
    partner.data = null
    expect((await POST(request())).status).toBe(403)
    expect(filters).toEqual([['user_id', 'verified-user']])
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it.each([
    { booked_via_link: true },
    { booked_via_link: 'false' },
    { status: 'booked' },
    { status: 'converted' },
    { credit_amount: 1000 },
    { credit_balance: 1000 },
    { converted_at: '2026-10-28T00:00:00Z' },
    { partner_id: 'another-partner' },
  ])('rejects a client claim to authority: %j', async (extra) => {
    expect((await POST(request(extra))).status).toBe(400)
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it.each([{}, { booked_via_link: false }])(
    'saves only a pending referral and a new lead: %j',
    async (extra) => {
      const response = await POST(request(extra))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        success: true,
        referral_id: 'saved-referral',
        status: 'pending',
        credit_awarded: false,
      })
      expect(writes).toEqual([
        [
          'referrals',
          {
            partner_id: 'saved-partner',
            client_name: 'Fixture Client',
            client_phone: '7195550100',
            notes: 'Needs carpet cleaning',
            status: 'pending',
            credit_amount: 20,
            booked_via_link: false,
          },
        ],
        [
          'leads',
          {
            source: 'partner',
            name: 'Fixture Client',
            phone: '7195550100',
            notes: 'Needs carpet cleaning',
            partner_id: 'saved-partner',
            status: 'new',
          },
        ],
      ])
    },
  )

  it('gets the potential referral amount from saved verification, without awarding it', async () => {
    partner.data!.backlink_verified = true
    await POST(request({ notes: null }))
    expect(writes[0]).toEqual([
      'referrals',
      expect.objectContaining({
        credit_amount: 25,
        notes: null,
        status: 'pending',
      }),
    ])
    expect(writes).toHaveLength(2)
  })

  it.each([
    { client_name: ' ' },
    { client_name: 123 },
    { client_phone: null },
    { client_phone: 'a'.repeat(51) },
    { notes: {} },
  ])('rejects invalid details before a write: %j', async (extra) => {
    expect((await POST(request(extra))).status).toBe(400)
    expect(writes).toEqual([])
  })

  it('rejects malformed JSON as a client error', async () => {
    const response = await POST(
      new NextRequest('https://example.test/api/partners/referrals', {
        method: 'POST',
        body: '{',
      }),
    )
    expect(response.status).toBe(400)
    expect(writes).toEqual([])
  })

  it.each([
    ['23505', 409],
    ['42501', 500],
  ] as const)(
    'stops after a failed referral insert (%s), without exposing database detail',
    async (code, status) => {
      referralError = { code, message: 'private database detail' }
      const response = await POST(request())
      expect(response.status).toBe(status)
      expect(JSON.stringify(await response.json())).not.toContain(
        'private database detail',
      )
      expect(writes).toHaveLength(1)
    },
  )

  it('does not invite referral resubmission when only secondary lead tracking fails', async () => {
    leadError = { message: 'tracking unavailable' }
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      referral_id: 'saved-referral',
      credit_awarded: false,
    })
    expect(writes).toHaveLength(2)
  })
})
