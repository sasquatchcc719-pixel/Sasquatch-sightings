import { NextResponse } from 'next/server'
import { requireClientManager } from '@/lib/auth'
import { loadCommercialAchInstructions } from '@/lib/ops/commercial-payment-server'

export async function GET() {
  try {
    await requireClientManager()
    return NextResponse.json(
      { instructions: loadCommercialAchInstructions() },
      {
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
        },
      },
    )
  } catch (error) {
    const unauthorized =
      error instanceof Error && error.message === 'Not a client manager'
    return NextResponse.json(
      {
        error: unauthorized
          ? 'Not authorized'
          : 'ACH payment details are temporarily unavailable.',
      },
      { status: unauthorized ? 403 : 503 },
    )
  }
}
