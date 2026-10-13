import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createAdminClient } from '@/supabase/server'
import {
  MCP_BUSINESS_SCOPE,
  MCP_INTERNAL_SCOPES,
  MCP_RESOURCE,
  MCP_RESOURCE_METADATA,
  supabaseAuthIssuer,
} from './constants'

type McpClaims = JWTPayload & {
  client_id?: unknown
  email?: unknown
  mcp_access?: unknown
  mcp_scopes?: unknown
  role?: unknown
}

export class McpAuthorizationError extends Error {
  constructor(
    message: string,
    readonly oauthError:
      | 'invalid_token'
      | 'insufficient_scope' = 'invalid_token',
  ) {
    super(message)
  }
}

let cachedJwks:
  | { issuer: string; value: ReturnType<typeof createRemoteJWKSet> }
  | undefined

function jwksForIssuer(issuer: string) {
  if (!cachedJwks || cachedJwks.issuer !== issuer) {
    cachedJwks = {
      issuer,
      value: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)),
    }
  }
  return cachedJwks.value
}

function bearerToken(header: string | null): string {
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(header || '')
  if (!match)
    throw new McpAuthorizationError('A Bearer access token is required')
  return match[1]
}

function hasBusinessReadScope(claims: McpClaims): boolean {
  return (
    claims.mcp_access === MCP_BUSINESS_SCOPE &&
    Array.isArray(claims.mcp_scopes) &&
    claims.mcp_scopes.includes(MCP_BUSINESS_SCOPE)
  )
}

function claimedInternalScopes(claims: McpClaims): string[] {
  if (!Array.isArray(claims.mcp_scopes)) return []
  const allowed = new Set<string>(MCP_INTERNAL_SCOPES)
  return claims.mcp_scopes.filter(
    (scope): scope is string => typeof scope === 'string' && allowed.has(scope),
  )
}

export async function authorizeMcpBearer(
  authorizationHeader: string | null,
): Promise<AuthInfo> {
  const token = bearerToken(authorizationHeader)
  const issuer = supabaseAuthIssuer()

  let claims: McpClaims
  try {
    const verified = await jwtVerify(token, jwksForIssuer(issuer), {
      issuer,
      audience: MCP_RESOURCE,
      algorithms: ['ES256', 'RS256'],
      clockTolerance: 5,
    })
    claims = verified.payload as McpClaims
  } catch {
    throw new McpAuthorizationError('The access token is invalid or expired')
  }

  if (
    typeof claims.sub !== 'string' ||
    typeof claims.client_id !== 'string' ||
    claims.role !== 'authenticated'
  ) {
    throw new McpAuthorizationError('The access token is missing OAuth claims')
  }
  if (!hasBusinessReadScope(claims)) {
    throw new McpAuthorizationError(
      'The access token does not grant read-only business access',
      'insufficient_scope',
    )
  }

  const claimedScopes = claimedInternalScopes(claims)

  const admin = createAdminClient()
  const { data: grant, error: grantError } = await admin
    .from('mcp_authorized_users')
    .select('user_id, scopes')
    .eq('user_id', claims.sub)
    .is('revoked_at', null)
    .maybeSingle()

  if (grantError) throw grantError
  if (!grant || !grant.scopes?.includes(MCP_BUSINESS_SCOPE)) {
    throw new McpAuthorizationError(
      'This account is not authorized for Sasquatch business data',
      'insufficient_scope',
    )
  }

  const grantedScopes = new Set(
    (grant.scopes || []).filter(
      (scope: unknown): scope is string => typeof scope === 'string',
    ),
  )
  const effectiveScopes = claimedScopes.filter((scope) =>
    grantedScopes.has(scope),
  )

  const { data: owner, error } = await admin
    .from('staff_users')
    .select('id, display_name')
    .eq('user_id', claims.sub)
    .eq('role', 'owner')
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw error
  if (!owner) {
    throw new McpAuthorizationError(
      'This account is not authorized for Sasquatch business data',
      'insufficient_scope',
    )
  }

  return {
    token,
    clientId: claims.client_id,
    scopes: effectiveScopes,
    expiresAt: claims.exp,
    resource: new URL(MCP_RESOURCE),
    extra: {
      subject: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      staffUserId: owner.id,
      displayName: owner.display_name,
    },
  }
}

export function mcpWwwAuthenticate(
  error: 'invalid_token' | 'insufficient_scope' = 'invalid_token',
  description = 'OAuth authorization is required',
): string {
  const safeDescription = description.replace(/["\\\r\n]/g, ' ')
  return `Bearer resource_metadata="${MCP_RESOURCE_METADATA}", scope="openid email", error="${error}", error_description="${safeDescription}"`
}
