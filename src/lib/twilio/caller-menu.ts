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
  const prompt = afterHours
    ? 'Thank you for calling Sasquatch Carpet Cleaning. If you have active water damage, a burst pipe, or flooding, press 2 now. For anything else, stay on the line to leave a message.'
    : `${attempt ? 'We did not receive a valid selection. ' : 'Thank you for calling Sasquatch Carpet Cleaning. '}To book or change an appointment, press 1. For active water damage, a burst pipe, or flooding, press 2.`
  return `<?xml version="1.0" encoding="UTF-8"?><Response>
  <Gather action="${escapeTwiml(action)}" method="POST" numDigits="1" timeout="10" actionOnEmptyResult="true">
    <Say>${prompt}</Say>
  </Gather>
</Response>`
}
