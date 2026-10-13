import { NextResponse } from 'next/server'
import {
  MCP_AUTH_SCOPES,
  MCP_RESOURCE,
  supabaseAuthIssuer,
} from '@/lib/mcp/constants'

export async function GET() {
  return NextResponse.json(
    {
      resource: MCP_RESOURCE,
      authorization_servers: [supabaseAuthIssuer()],
      scopes_supported: [...MCP_AUTH_SCOPES],
      bearer_methods_supported: ['header'],
      resource_documentation: 'https://sightings.sasquatchcarpet.com/mcp/about',
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'Content-Type': 'application/json',
      },
    },
  )
}
