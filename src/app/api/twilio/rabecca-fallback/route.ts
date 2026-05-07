import { NextRequest, NextResponse } from 'next/server'
import { getCallRoutingConfig } from '@/lib/twilio/call-routing-config'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const callerPhone = formData.get('From') as string
    const dialCallStatus = formData.get('DialCallStatus') as string
    const routingConfig = await getCallRoutingConfig()

    if (['completed', 'answered'].includes(dialCallStatus)) {
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } },
      )
    }

    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>I am having trouble connecting scheduling right now. I will try the team instead.</Say>
  <Dial timeout="${routingConfig.ivrTechnicalTimeoutSeconds}" callerId="${callerPhone}" answerOnBridge="true">
    <Number>${routingConfig.primaryForwardNumber}</Number>
    <Client>admin_charles</Client>
  </Dial>
  <Say>We could not connect anyone right now. Please try again shortly. Goodbye.</Say>
</Response>`

    return new NextResponse(twimlResponse, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (error) {
    console.error('[Rabecca Fallback] Error:', error)
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>We are having trouble connecting your call. Please try again shortly. Goodbye.</Say></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } },
    )
  }
}
