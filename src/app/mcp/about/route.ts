import { connection, NextResponse } from 'next/server'
import { getMcpReleaseManifest } from '@/lib/mcp/release'

export async function GET() {
  await connection()
  return NextResponse.json(
    {
      name: 'Sasquatch Sightings operations MCP',
      endpoint: 'https://sightings.sasquatchcarpet.com/mcp',
      server: getMcpReleaseManifest(),
      access:
        'OAuth-authorized owner access. Reads use business:read; saved drafts and business actions require separate server-side grants plus exact preview and confirmation.',
      limitations: [
        'All dates without offsets use America/Denver.',
        'Availability assumes a 120-minute appointment and is not a booking.',
        'List responses default to 50 records and allow at most 100.',
        'Customer contact and record changes require an expiring preview, action-time confirmation, idempotency, record-version checks, and audit.',
        'No arbitrary HTTP, SQL, shell, code, environment, token, or security-administration tools are exposed.',
      ],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
