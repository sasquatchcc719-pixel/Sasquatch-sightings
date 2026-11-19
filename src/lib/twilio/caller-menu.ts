import { escapeTwiml } from './forward-twiml'

// Require a caller selection before forwarding. One repeat gives a person
// another chance without letting a silent robocall ring the owners' phones.
export function buildCallerMenu({
  baseUrl,
  afterHours = false,
  attempt = 0,
}: {
  baseUrl: string
  afterHours?: boolean
  attempt?: number
}) {
  const action = `${baseUrl}/api/twilio/ivr-menu?context=${afterHours ? 'after-hours' : 'business-hours'}&attempt=${attempt}`
  const greeting = attempt
    ? 'We did not receive a valid selection. '
    : 'Thank you for calling Sasquatch Carpet Cleaning. '
  const prompt = afterHours
    ? `${greeting}If you have active water damage, a burst pipe, or flooding, press 1. Otherwise, please stay on the line to leave a message.`
    : `${greeting}For active water damage, a burst pipe, or flooding, press 1. To book or change an appointment, press 2.`
  return `<?xml version="1.0" encoding="UTF-8"?><Response>
  <Gather action="${escapeTwiml(action)}" method="POST" numDigits="1" timeout="10" actionOnEmptyResult="true">
    <Say>${prompt}</Say>
  </Gather>
</Response>`
}

export type HarryMenuContext = 'harry-preview' | 'harry-public'

export function buildHarryDirectory(
  baseUrl: string,
  context: HarryMenuContext,
  confirmFlood = false,
) {
  const url = `${baseUrl}/api/twilio/ivr-menu?context=${context}${confirmFlood ? '&flood=confirm' : ''}`
  const prompt = confirmFlood
    ? 'If water is actively flooding the property, press 1 to reach the emergency line. Otherwise, stay on the line to leave a message.'
    : 'Thanks for calling the Sasquatch Carpet Cleaning after-hours directory. For cleaning questions or scheduling, press 1 to speak with Harry, our virtual assistant. For active flooding, press 2. To leave a message, stay on the line.'
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather action="${escapeTwiml(url)}" method="POST" input="dtmf" numDigits="1" timeout="10" actionOnEmptyResult="true"><Say>${prompt}</Say></Gather></Response>`
}
