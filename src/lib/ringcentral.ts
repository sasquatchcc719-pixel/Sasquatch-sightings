/**
 * RingCentral Helper Functions
 * Handles SMS sending and webhook validation
 */

interface RingCentralWebhookPayload {
  uuid: string
  event: string
  timestamp: string
  subscriptionId: string
  body: {
    extensionId: string
    telephonyStatus: string
    activeCalls?: Array<{
      id: string
      direction: 'Inbound' | 'Outbound'
      from: string
      fromName?: string
      to: string
      toName?: string
      telephonyStatus: string
      sipData?: {
        toTag?: string
        fromTag?: string
        remoteUri?: string
        localUri?: string
      }
    }>
  }
}

interface MissedCallData {
  phone: string
  name?: string
  timestamp: string
}

/**
 * Parse RingCentral webhook payload to detect missed calls
 */
export function parseMissedCall(
  payload: RingCentralWebhookPayload
): MissedCallData | null {
  const { body } = payload

  // Check if telephonyStatus is "NoCall" (call ended)
  if (body.telephonyStatus !== 'NoCall') {
    return null
  }

  // Check if there was a previous active call that was missed
  // In RingCentral, a missed call means the call was ringing but not answered
  // We need to check the activeCalls array (which will be empty now)
  // Or check the previous state - this gets tricky
  
  // For now, we'll rely on the webhook event type
  if (payload.event !== '/restapi/v1.0/account/~/extension/~/presence') {
    return null
  }

  // Since NoCall doesn't give us call details, we need to check
  // if this was triggered after a ring with no answer
  // This requires maintaining state or checking previous events
  
  // Simplified approach: Check for specific presence event indicating missed call
  // You may need to adjust this based on actual RingCentral webhook structure
  
  return null // Placeholder - needs actual implementation
}

/**
 * Send SMS via RingCentral API
 */
export async function sendRingCentralSMS(
  toPhone: string,
  message: string
): Promise<boolean> {
  const clientId = process.env.RINGCENTRAL_CLIENT_ID
  const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET
  const jwtToken = process.env.RINGCENTRAL_JWT

  if (!clientId || !clientSecret || !jwtToken) {
    console.warn('RingCentral credentials not configured, skipping SMS')
    return false
  }

  try {
    // Get access token using JWT
    const SDK = require('@ringcentral/sdk').SDK

    const rcsdk = new SDK({
      server: 'https://platform.ringcentral.com',
      clientId,
      clientSecret,
    })

    const platform = rcsdk.platform()
    await platform.login({ jwt: jwtToken })

    // Send SMS
    const response = await platform.post('/restapi/v1.0/account/~/extension/~/sms', {
      from: { phoneNumber: process.env.RINGCENTRAL_PHONE_NUMBER },
      to: [{ phoneNumber: toPhone }],
      text: message,
    })

    const result = await response.json()
    console.log('SMS sent via RingCentral:', result.id)
    return true
  } catch (error) {
    console.error('Failed to send RingCentral SMS:', error)
    return false
  }
}

/**
 * Validate RingCentral webhook signature (optional security)
 */
export function validateRingCentralWebhook(
  payload: string,
  signature: string,
  validationToken: string
): boolean {
  // Implement HMAC validation if needed
  // RingCentral uses validation tokens for webhook security
  return true // Placeholder
}
