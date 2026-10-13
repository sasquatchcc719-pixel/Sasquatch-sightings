// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => 'test-jwks'),
  from: vi.fn(),
}))

vi.mock('jose', () => ({
  createRemoteJWKSet: mocks.createRemoteJWKSet,
  jwtVerify: mocks.jwtVerify,
}))

vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))

import { authorizeMcpBearer, McpAuthorizationError } from './auth'
import { MCP_RESOURCE } from './constants'

const subject = 'f8b5e475-eaee-4b1c-9cf1-e40b7195a22f'

function queryResult(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    contains: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.is.mockReturnValue(query)
  query.contains.mockReturnValue(query)
  return query
}

function validClaims(overrides: Record<string, unknown> = {}) {
  return {
    sub: subject,
    client_id: 'chatgpt-test-client',
    role: 'authenticated',
    email: 'owner@example.com',
    exp: 2_000_000_000,
    mcp_access: 'business:read',
    mcp_scopes: ['business:read'],
    ...overrides,
  }
}

function allowDatabaseChecks(options?: { grant?: boolean; owner?: boolean }) {
  mocks.from.mockImplementation((table: string) => {
    if (table === 'mcp_authorized_users') {
      return queryResult({
        data: options?.grant === false ? null : { user_id: subject },
        error: null,
      })
    }
    if (table === 'staff_users') {
      return queryResult({
        data:
          options?.owner === false
            ? null
            : { id: 'staff-id', display_name: 'Charles' },
        error: null,
      })
    }
    throw new Error(`Unexpected table: ${table}`)
  })
}

describe('MCP OAuth authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
    mocks.jwtVerify.mockResolvedValue({ payload: validClaims() })
    allowDatabaseChecks()
  })

  it('validates issuer, resource audience, algorithms, scope, grant, and owner', async () => {
    const auth = await authorizeMcpBearer('Bearer valid.test.token')

    expect(mocks.jwtVerify).toHaveBeenCalledWith(
      'valid.test.token',
      'test-jwks',
      expect.objectContaining({
        issuer: 'https://project.supabase.co/auth/v1',
        audience: MCP_RESOURCE,
        algorithms: ['ES256', 'RS256'],
      }),
    )
    expect(auth).toMatchObject({
      clientId: 'chatgpt-test-client',
      scopes: ['business:read'],
      expiresAt: 2_000_000_000,
      extra: { subject, staffUserId: 'staff-id' },
    })
  })

  it.each([null, 'Basic abc', 'bearer token', 'Bearer token with spaces'])(
    'accepts only the exact Bearer header scheme: %s',
    async (header) => {
      await expect(authorizeMcpBearer(header)).rejects.toBeInstanceOf(
        McpAuthorizationError,
      )
      expect(mocks.jwtVerify).not.toHaveBeenCalled()
    },
  )

  it('rejects invalid or expired JWTs', async () => {
    mocks.jwtVerify.mockRejectedValue(new Error('JWTExpired'))

    await expect(
      authorizeMcpBearer('Bearer expired.test.token'),
    ).rejects.toMatchObject({ oauthError: 'invalid_token' })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects a token without the internal read grant before querying data', async () => {
    mocks.jwtVerify.mockResolvedValue({
      payload: validClaims({ mcp_access: undefined, mcp_scopes: [] }),
    })

    await expect(
      authorizeMcpBearer('Bearer valid.test.token'),
    ).rejects.toMatchObject({ oauthError: 'insufficient_scope' })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects a revoked database grant', async () => {
    allowDatabaseChecks({ grant: false })

    await expect(
      authorizeMcpBearer('Bearer valid.test.token'),
    ).rejects.toMatchObject({ oauthError: 'insufficient_scope' })
  })

  it('rejects an inactive or non-owner staff account', async () => {
    allowDatabaseChecks({ owner: false })

    await expect(
      authorizeMcpBearer('Bearer valid.test.token'),
    ).rejects.toMatchObject({ oauthError: 'insufficient_scope' })
  })
})
