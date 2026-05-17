/**
 * Server-side proxy for the public booking widget.
 * Adds the BOOKING_API_SECRET header so it never ships in browser bundles.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isBlacklisted, notifyBlockedAttempt } from '@/lib/blacklist'

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.BOOKING_API_SECRET
    if (!secret) {
      return NextResponse.json(
        { error: 'Booking service not configured.' },
        { status: 503 },
      )
    }

    const body = await request.json()

    if (body.phone && (await isBlacklisted(body.phone))) {
      notifyBlockedAttempt(body.phone, 'web booking')
      return NextResponse.json(
        { error: 'Something went wrong. Please try again later.' },
        { status: 422 },
      )
    }

    // Build the internal URL so this works on any hostname (dev + production)
    const internalUrl = new URL(
      '/api/public/appointments',
      request.url,
    ).toString()

    const result = await fetch(internalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-booking-secret': secret,
      },
      body: JSON.stringify(body),
    })

    const data = await result.json()
    return NextResponse.json(data, { status: result.status })
  } catch (err) {
    console.error('[/api/book] proxy error:', err)
    return NextResponse.json(
      { error: 'Failed to create appointment. Please call (719) 249-8791.' },
      { status: 500 },
    )
  }
}
