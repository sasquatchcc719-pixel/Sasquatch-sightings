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
        'OAuth-authorized owner access. Reads use business:read; drafts and business actions use separate live grants. A matching direct owner instruction counts as authorization after exact preview and revalidation.',
      limitations: [
        'All dates without offsets use America/Denver.',
        'Commercial Outreach uses current DOTS Harry through its separately controlled workspace and delivery worker. Real measuring creation remains disabled. Never substitute ordinary booking/contact tools.',
        'Availability assumes a 120-minute appointment and is not a booking.',
        'List responses default to 50 records and allow at most 100.',
        'Customer contact and record changes use an expiring exact preview, idempotency, record-version checks, and audit. ChatGPT may still show one native approval control for write tools.',
        'Routine factual replies and exact customer-accepted scheduling may proceed under the standing secretary policy; new or materially changed commitments require one owner confirmation.',
        'No arbitrary HTTP, SQL, shell, code, environment, token, or security-administration tools are exposed.',
      ],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
