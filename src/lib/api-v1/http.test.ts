// @vitest-environment node
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  insert: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/supabase/server', () => ({
  createAdminClient: mocks.createAdminClient,
}))

import {
  handleApiV1Get,
  hasValidBearerCredential,
  isHttpsRequest,
  methodNotAllowed,
} from './http'

const rawKey = 'sq_merlin_test-key-with-more-than-32-random-bytes'
const keyHash = createHash('sha256').update(rawKey).digest('hex')

beforeEach(() => {
  vi.clearAllMocks()
  process.env.MERLIN_READ_API_KEY_SHA256 = keyHash
  mocks.insert.mockResolvedValue({ error: null })
  mocks.rpc.mockResolvedValue({
    data: [{ allowed: true, retry_after_seconds: 0 }],
    error: null,
  })
  mocks.createAdminClient.mockReturnValue({
    rpc: mocks.rpc,
    from: vi.fn().mockReturnValue({ insert: mocks.insert }),
  })
})

describe('Merlin bearer authentication', () => {
  it('accepts only an exact Bearer header and compares its SHA-256 digest', () => {
    expect(hasValidBearerCredential(`Bearer ${rawKey}`, keyHash)).toBe(true)
    expect(hasValidBearerCredential(`bearer ${rawKey}`, keyHash)).toBe(false)
    expect(hasValidBearerCredential(`Bearer  ${rawKey}`, keyHash)).toBe(false)
    expect(hasValidBearerCredential(rawKey, keyHash)).toBe(false)
    expect(hasValidBearerCredential('Bearer wrong-key', keyHash)).toBe(false)
  })

  it('requires HTTPS or a trusted HTTPS forwarding marker', () => {
    expect(
      isHttpsRequest(new Request('https://example.com/api/v1/customers')),
    ).toBe(true)
    expect(
      isHttpsRequest(new Request('http://example.com/api/v1/customers')),
    ).toBe(false)
    expect(
      isHttpsRequest(
        new Request('http://internal/api/v1/customers', {
          headers: { 'x-forwarded-proto': 'https' },
        }),
      ),
    ).toBe(true)
  })

  it('returns 401 without consulting cookies, sessions, or the rate limiter', async () => {
    const request = new NextRequest('https://example.com/api/v1/customers')
    const handler = vi.fn()

    const response = await handleApiV1Get(request, handler)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(response.headers.get('www-authenticate')).toBe('Bearer')
    expect(handler).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('runs an authorized GET after consuming one shared rate-limit token', async () => {
    const request = new NextRequest('https://example.com/api/v1/customers', {
      headers: { authorization: `Bearer ${rawKey}` },
    })

    const response = await handleApiV1Get(request, async () =>
      NextResponse.json({ data: [] }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('vary')).toBe('Authorization')
    expect(mocks.rpc).toHaveBeenCalledWith('consume_api_v1_token', {
      p_key_label: 'merlin-read',
    })
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/customers',
        status: 200,
        key_label: 'merlin-read',
      }),
    )
  })

  it('returns 429 with Retry-After when the shared bucket is empty', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ allowed: false, retry_after_seconds: 3 }],
      error: null,
    })
    const request = new NextRequest('https://example.com/api/v1/customers', {
      headers: { authorization: `Bearer ${rawKey}` },
    })

    const response = await handleApiV1Get(request, async () =>
      NextResponse.json({ data: [] }),
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('3')
    expect(await response.json()).toEqual({ error: 'Rate limit exceeded' })
  })

  it('returns a JSON 405 with an Allow header for every write method', async () => {
    const response = await methodNotAllowed(
      new NextRequest('https://example.com/api/v1/customers', {
        method: 'POST',
      }),
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(await response.json()).toEqual({ error: 'Method not allowed' })
  })

  it('rejects non-TLS write requests before method handling', async () => {
    const response = await methodNotAllowed(
      new NextRequest('http://example.com/api/v1/customers', {
        method: 'DELETE',
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'HTTPS is required' })
  })
})
