import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    name: 'Sasquatch Sightings read-only MCP',
    endpoint: 'https://sightings.sasquatchcarpet.com/mcp',
    access:
      'OAuth-authorized, read-only access for the Sasquatch Carpet Cleaning owner account.',
    limitations: [
      'All dates without offsets use America/Denver.',
      'Availability assumes a 120-minute appointment and is not a booking.',
      'List responses default to 50 records and allow at most 100.',
      'No write, booking, messaging, SQL, or arbitrary HTTP tools are exposed.',
    ],
  })
}
