// @vitest-environment node
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  signSightingSubmission,
  SIGHTING_SUBMISSION_COOKIE,
} from '@/lib/sighting-submission'

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  notification: vi.fn(),
  sms: vi.fn(),
  geocode: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/onesignal', () => ({
  sendOneSignalNotification: mocks.notification,
}))
vi.mock('@/lib/twilio', () => ({
  sendAdminSMS: mocks.sms,
  sendCustomerSMS: mocks.sms,
}))
vi.mock('@/lib/geocode', () => ({ reverseGeocode: mocks.geocode }))
import { POST as submit } from './route'
import { POST as verify } from './[id]/verify/route'

const id = '00000000-0000-4000-8000-000000000001'
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only-signing-key')
  mocks.admin.mockReturnValue({ from: mocks.from })
  mocks.from.mockImplementation((table) => {
    let operation = 'read'
    const query = {
      select: (fields: string) => {
        mocks.select(table, fields)
        return query
      },
      insert: (value: unknown) => {
        operation = 'insert'
        mocks.insert(table, value)
        return query
      },
      update: (value: unknown) => {
        operation = 'update'
        mocks.update(table, value)
        return query
      },
      eq: () => query,
      single: async () => ({
        data:
          table === 'sightings' && operation === 'read'
            ? null
            : {
                id,
                share_verified: true,
                email: 'private@example.test',
                phone_number: 'private',
                gps_lat: 39,
              },
        error: null,
      }),
    }
    return query
  })
})
afterEach(() => vi.unstubAllEnvs())

function submission(fields: Record<string, string | undefined> = {}) {
  const body = new FormData()
  for (const [key, value] of Object.entries({
    fullName: 'Test Person',
    phoneNumber: '7195550100',
    email: 'test@example.test',
    ...fields,
  })) {
    if (value !== undefined) body.append(key, value)
  }
  return new NextRequest('https://example.test/api/sightings', {
    method: 'POST',
    body,
  })
}
function verification(token?: string, target = id) {
  return verify(
    new NextRequest(`https://example.test/api/sightings/${target}/verify`, {
      method: 'POST',
      headers: token
        ? { cookie: `${SIGHTING_SUBMISSION_COOKIE}=${token}` }
        : {},
    }),
    { params: Promise.resolve({ id: target }) },
  )
}

describe('public contest server boundary', () => {
  it.each([
    { fullName: '' },
    { email: 'invalid' },
    { phoneNumber: 'x' },
    { gpsLat: '91', gpsLng: '-105' },
    { gpsLat: '39' },
    { gpsLat: '39junk', gpsLng: '-105' },
    { partnerId: 'not-a-uuid' },
    { image: 'not-a-file' },
  ])(
    'validates %j before privileged access or notifications',
    async (fields) => {
      expect((await submit(submission(fields))).status).toBe(400)
      expect(mocks.admin).not.toHaveBeenCalled()
      expect(mocks.notification).not.toHaveBeenCalled()
      expect(mocks.sms).not.toHaveBeenCalled()
    },
  )

  it('keeps a valid contest submission working without exposing private saved fields', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const response = await submit(submission())
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      success: true,
      message: 'Sighting logged successfully',
      data: { id },
      couponCode: 'SCC20',
    })
    expect(mocks.select).toHaveBeenCalledWith('sightings', 'id')
    expect(mocks.select).not.toHaveBeenCalledWith('sightings', undefined)
    expect(mocks.insert).toHaveBeenCalledWith(
      'sightings',
      expect.objectContaining({
        full_name: 'Test Person',
        email: 'test@example.test',
        coupon_redeemed: false,
      }),
    )
    const cookie = response.headers.get('set-cookie')!
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Path=/api/sightings')
    expect(cookie).toContain('SameSite=lax')
    expect(cookie).toContain('Secure')
    const ownVerification = await verification(
      response.cookies.get(SIGHTING_SUBMISSION_COOKIE)?.value,
    )
    expect(ownVerification.status).toBe(200)
  })

  it('fails before a submission write if verification cannot be configured', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    expect((await submit(submission())).status).toBe(503)
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.notification).not.toHaveBeenCalled()
    expect(mocks.sms).not.toHaveBeenCalled()
  })
})

describe('share verification belongs to the submitting browser', () => {
  it.each(['missing', 'tampered', 'expired', 'different-id'])(
    'rejects %s proof before all writes',
    async (kind) => {
      const token =
        kind === 'missing'
          ? undefined
          : kind === 'expired'
            ? signSightingSubmission(id, Date.now() - 25 * 3600 * 1000)
            : kind === 'different-id'
              ? signSightingSubmission('other-submission')
              : `${signSightingSubmission(id)}tampered`
      expect((await verification(token)).status).toBe(403)
      expect(mocks.admin).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
    },
  )

  it('verifies only the saved submission ID and returns a bounded DTO', async () => {
    const response = await verification(signSightingSubmission(id))
    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith('sightings', {
      share_verified: true,
    })
    expect(mocks.select).toHaveBeenCalledWith('sightings', 'id, share_verified')
    expect(await response.json()).toEqual({
      success: true,
      message: 'Entry verified',
      data: { id, share_verified: true },
    })
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('fails closed when the signing key is unavailable', async () => {
    const token = signSightingSubmission(id)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    expect((await verification(token)).status).toBe(403)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})
