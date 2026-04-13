import { NextResponse } from 'next/server'
import { getUserWithRole } from '@/lib/auth'
import twilio from 'twilio'

const { AccessToken } = twilio.jwt

export async function POST() {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const apiKeySid = process.env.TWILIO_API_KEY_SID
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET
    const twimlAppSid = process.env.TWILIO_TWIML_APP_SID

    if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
      return NextResponse.json(
        {
          error:
            'Voice calling not configured. Set TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, and TWILIO_TWIML_APP_SID.',
        },
        { status: 500 },
      )
    }

    const identity = `admin_${user.id.slice(0, 8)}`

    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity,
      ttl: 3600,
    })

    const voiceGrant = new AccessToken.VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: false,
    })
    token.addGrant(voiceGrant)

    return NextResponse.json({ token: token.toJwt(), identity })
  } catch (error) {
    console.error('[voice-token] Error:', error)
    return NextResponse.json(
      { error: 'Failed to generate voice token' },
      { status: 500 },
    )
  }
}
