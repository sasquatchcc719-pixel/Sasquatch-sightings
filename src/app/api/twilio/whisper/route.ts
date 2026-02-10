import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const digits = formData.get('Digits')

  let twiml

  if (digits === '1') {
    // User accepted. End TwiML to connect parties.
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting.</Say>
</Response>`
  } else {
    // Prompt user
    // If they don't press 1, we Hangup (which fails the dial leg, triggering the main Dial action -> Voicemail)
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" timeout="10">
    <Say>Call from Sasquatch. Press 1 to accept.</Say>
  </Gather>
  <Hangup/>
</Response>`
  }

  return new NextResponse(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}
