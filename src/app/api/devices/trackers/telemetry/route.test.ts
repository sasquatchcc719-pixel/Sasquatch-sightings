import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/supabase/server', () => ({ createAdminClient: () => ({ rpc }) }))
import { POST } from './route'

const token = 'a'.repeat(64)
const payload = {
  firmware: '0.1.0',
  bootId: '7a092418-a1be-4d3a-811e-bb1ab72e0d99',
  uptimeMs: 100,
  batteryV: null,
  gpsFix: false,
  points: [],
}
function request(
  body: string,
  authorization: string | null = `Bearer ${token}`,
) {
  return new NextRequest(
    'https://example.test/api/devices/trackers/telemetry',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body,
    },
  )
}

describe('device telemetry endpoint', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: { ok: true, accepted: 0 }, error: null })
  })
  it('requires a device credential before touching the database', async () => {
    expect((await POST(request(JSON.stringify(payload), null))).status).toBe(
      401,
    )
    expect(rpc).not.toHaveBeenCalled()
  })
  it('passes only a hash of the credential to the atomic ingest function', async () => {
    const response = await POST(request(JSON.stringify(payload)))
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('ingest_fleet_tracker', {
      p_token_hash: createHash('sha256').update(token).digest('hex'),
      p_payload: payload,
    })
    expect(await response.text()).not.toContain(token)
  })
  it('rejects oversized bodies even without a Content-Length header', async () => {
    expect(
      (await POST(request(JSON.stringify({ padding: 'a'.repeat(33000) }))))
        .status,
    ).toBe(413)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects malformed GPS data rather than plotting it', async () => {
    expect(
      (
        await POST(
          request(JSON.stringify({ ...payload, points: [{ lat: 500 }] })),
        )
      ).status,
    ).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects future timestamps before they can displace a real current location', async () => {
    const point = {
      bootId: payload.bootId,
      seq: 1,
      recordedAt: new Date(Date.now() + 3600_000).toISOString(),
      lat: 39,
      lng: -104,
      speedMps: null,
      bearing: null,
      satellites: null,
    }
    expect(
      (await POST(request(JSON.stringify({ ...payload, points: [point] }))))
        .status,
    ).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([
    ['Unauthorized', 401],
    ['Too many requests', 429],
  ])('honors %s returned by the locked device check', async (error, status) => {
    rpc.mockResolvedValue({ data: { error }, error: null })
    expect((await POST(request(JSON.stringify(payload)))).status).toBe(status)
  })
  it('does not acknowledge a failed database write', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'unavailable' } })
    expect((await POST(request(JSON.stringify(payload)))).status).toBe(503)
  })
})
