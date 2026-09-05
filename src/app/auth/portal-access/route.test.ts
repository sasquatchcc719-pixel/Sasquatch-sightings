import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ verifyOtp: vi.fn() }))
vi.mock('@/supabase/server', () => ({
  createClient: async () => ({ auth: { verifyOtp: mocks.verifyOtp } }),
}))
import { GET, POST } from './route'
const origin = 'https://sightings.sasquatchcarpet.com'
const token = 'a'.repeat(64)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyOtp.mockResolvedValue({ error: null })
})
describe('scanner-safe customer entry', () => {
  it('GET displays the Continue form without consuming a token or loading analytics', async () => {
    const response = await GET(
      new NextRequest(`${origin}/auth/portal-access?token_hash=${token}`),
    )
    const html = await response.text()
    expect(html).toContain('Continue to your account')
    expect(html).toContain('method="post"')
    expect(html).not.toContain('<script')
    expect(response.headers.get('referrer-policy')).toBe('strict-origin')
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })
  it('consumes the token only on explicit same-origin POST and redirects to the customer account', async () => {
    const response = await POST(
      new NextRequest(`${origin}/auth/portal-access`, {
        method: 'POST',
        headers: {
          origin,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ token_hash: token }).toString(),
      }),
    )
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      type: 'magiclink',
      token_hash: token,
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${origin}/client`)
  })
  it('rejects cross-origin login submission', async () => {
    const response = await POST(
      new NextRequest(`${origin}/auth/portal-access`, {
        method: 'POST',
        headers: { origin: 'https://other.example.com' },
        body: new URLSearchParams({ token_hash: token }),
      }),
    )
    expect(response.status).toBe(403)
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })
  it('provides login and recovery options for an expired link', async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { message: 'Expired' } })
    const response = await POST(
      new NextRequest(`${origin}/auth/portal-access`, {
        method: 'POST',
        headers: {
          origin,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ token_hash: token }).toString(),
      }),
    )
    const recovery = await GET(
      new NextRequest(response.headers.get('location')!),
    )
    expect(await recovery.text()).toContain('/auth/forgot-password')
  })
})
