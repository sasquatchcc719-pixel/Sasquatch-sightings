export const MCP_RESOURCE = 'https://sightings.sasquatchcarpet.com/mcp'
export const MCP_RESOURCE_METADATA =
  'https://sightings.sasquatchcarpet.com/.well-known/oauth-protected-resource'
export const MCP_AUTH_SCOPES = ['openid', 'email'] as const
export const MCP_BUSINESS_SCOPE = 'business:read'

export function supabaseAuthIssuer(): string {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!projectUrl) throw new Error('Supabase URL is not configured')
  return `${projectUrl.replace(/\/$/, '')}/auth/v1`
}
