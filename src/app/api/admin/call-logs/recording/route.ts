import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])

    const url = request.nextUrl.searchParams.get('url')
    if (!url) {
      return NextResponse.json({ error: 'Missing url param' }, { status: 400 })
    }

    // Only proxy Twilio recording URLs
    if (!url.startsWith('https://api.twilio.com/')) {
      return NextResponse.json(
        { error: 'Invalid recording URL' },
        { status: 400 },
      )
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    if (!accountSid || !authToken) {
      return NextResponse.json(
        { error: 'Twilio credentials not configured' },
        { status: 500 },
      )
    }

    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString(
      'base64',
    )
    const twilioRes = await fetch(url, {
      headers: { Authorization: `Basic ${credentials}` },
    })

    if (!twilioRes.ok) {
      return NextResponse.json(
        { error: 'Recording not found' },
        { status: twilioRes.status },
      )
    }

    const audio = await twilioRes.arrayBuffer()
    return new NextResponse(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    console.error('[call-logs/recording][GET]', err)
    return NextResponse.json(
      { error: 'Failed to load recording' },
      { status: 500 },
    )
  }
}
