// @vitest-environment node
// Isolated request fixtures: the database client is always mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  handle: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: mocks.createAdminClient,
}))
vi.mock('@/lib/outreach/measurements', async (load) => {
  const original = await load<typeof import('@/lib/outreach/measurements')>()
  return { ...original, handleMeasurementAction: mocks.handle }
})
import { POST } from './route'
const secret = 'local-test-secret-never-real-32-characters'
function request(body: string, auth?: string) {
  return new NextRequest(
    'https://example.test/api/integrations/outreach/measurements',
    {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
    },
  )
}
beforeEach(() => {
  vi.stubEnv('OUTREACH_BRIDGE_SECRET', secret)
  vi.stubEnv('OUTREACH_MEASUREMENT_WRITES_ENABLED', 'false')
  vi.clearAllMocks()
  mocks.createAdminClient.mockReturnValue({ local: true })
})
describe('Outreach measuring route boundary', () => {
  it('rejects absent/wrong credentials before creating a privileged client', async () => {
    expect((await POST(request('{}'))).status).toBe(401)
    expect((await POST(request('{}', 'bad'))).status).toBe(401)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('rejects malformed and oversized requests before DB calls', async () => {
    expect((await POST(request('not JSON', secret))).status).toBe(400)
    expect(
      (await POST(request(JSON.stringify({ action: 'send_email' }), secret)))
        .status,
    ).toBe(400)
    expect((await POST(request('x'.repeat(40001), secret))).status).toBe(413)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('passes the default-off write gate and returns private uncached results', async () => {
    mocks.handle.mockResolvedValue({ status: 'not_found', receipt: null })
    const response = await POST(
      request(
        JSON.stringify({
          action: 'status',
          operation_key: '10000000-0000-4000-8000-000000000001',
        }),
        secret,
      ),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.handle).toHaveBeenCalledWith(
      { local: true },
      expect.objectContaining({ action: 'status' }),
      secret,
      false,
    )
  })
  it('never returns privileged exception details', async () => {
    mocks.handle.mockRejectedValue(
      new Error('private token should never appear'),
    )
    const response = await POST(
      request(
        JSON.stringify({
          action: 'status',
          operation_key: '10000000-0000-4000-8000-000000000001',
        }),
        secret,
      ),
    )
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private token')
  })
})
