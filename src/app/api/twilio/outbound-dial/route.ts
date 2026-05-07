import { NextResponse } from 'next/server'

export async function POST() {
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>This dial by phone feature has been retired. Please use the Sasquatch Sightings phone tool instead. Goodbye.</Say>
</Response>`

  return new NextResponse(twimlResponse, {
    status: 200,
    headers: {
      'Content-Type': 'text/xml',
    },
  })
}
