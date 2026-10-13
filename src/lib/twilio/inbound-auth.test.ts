// @vitest-environment node
import { describe, expect, it } from 'vitest'
import twilio from 'twilio'
import { validateTwilioInboundRequest } from './inbound-auth'

const url = 'https://sightings.sasquatchcarpet.com/api/twilio/sms-incoming'
const accountSid = `AC${'1'.repeat(32)}`
const form = {
  AccountSid: accountSid,
  MessageSid: `SM${'2'.repeat(32)}`,
  From: '+17195550123',
  To: '+17195550999',
  Body: 'Synthetic test only',
}

function signedRequest(signature: string) {
  return new Request(url, {
    method: 'POST',
    headers: { 'x-twilio-signature': signature },
  })
}

describe('Twilio inbound request authentication', () => {
  it('accepts the correct account and signature', () => {
    const authToken = 'synthetic-auth-token'
    const signature = twilio.getExpectedTwilioSignature(authToken, url, form)
    expect(
      validateTwilioInboundRequest({
        request: signedRequest(signature),
        form,
        authToken,
        accountSid,
        publicUrl: url,
      }),
    ).toBe(true)
  })

  it('rejects forged signatures and wrong accounts', () => {
    expect(
      validateTwilioInboundRequest({
        request: signedRequest('forged'),
        form,
        authToken: 'synthetic-auth-token',
        accountSid,
        publicUrl: url,
      }),
    ).toBe(false)
    expect(
      validateTwilioInboundRequest({
        request: signedRequest('forged'),
        form,
        authToken: 'synthetic-auth-token',
        accountSid: `AC${'9'.repeat(32)}`,
        publicUrl: url,
      }),
    ).toBe(false)
  })
})
