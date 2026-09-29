import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireClientManager } from '@/lib/auth'
import {
  consumeCommercialAchAccess,
  requestCommercialAchAccess,
} from '@/lib/ops/commercial-ach-approval'
import { loadCommercialAchInstructions } from '@/lib/ops/commercial-payment-server'

const requestIdSchema = z.uuid()

const noStoreHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
}

export async function POST() {
  try {
    const { user, client } = await requireClientManager()
    const accessRequest = await requestCommercialAchAccess({
      customerId: client.customer_id,
      userId: user.id,
      requesterName: client.display_name,
      requesterEmail: user.email,
    })
    return NextResponse.json(
      { request_id: accessRequest.id, status: accessRequest.status },
      {
        status: accessRequest.status === 'approved' ? 200 : 202,
        headers: noStoreHeaders,
      },
    )
  } catch (error) {
    const unauthorized =
      error instanceof Error && error.message === 'Not a client manager'
    return NextResponse.json(
      {
        error: unauthorized
          ? 'Not authorized'
          : error instanceof Error && error.message.includes('Telegram')
            ? 'The approval request could not reach Charles. Please try again.'
            : 'ACH access could not be requested.',
      },
      { status: unauthorized ? 403 : 503, headers: noStoreHeaders },
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireClientManager()
    const requestId = requestIdSchema.parse(
      request.nextUrl.searchParams.get('request_id'),
    )
    const access = await consumeCommercialAchAccess({
      requestId,
      customerId: client.customer_id,
      userId: user.id,
    })

    if (access.status === 'approved') {
      return NextResponse.json(
        {
          status: 'revealed',
          instructions: loadCommercialAchInstructions(),
        },
        { headers: noStoreHeaders },
      )
    }
    if (access.status === 'pending') {
      return NextResponse.json(
        { status: 'pending' },
        { status: 202, headers: noStoreHeaders },
      )
    }
    const status = access.status === 'not_found' ? 404 : 403
    const error =
      access.status === 'denied'
        ? 'Charles denied this ACH access request.'
        : access.status === 'expired'
          ? 'This ACH access request expired. Submit a new request.'
          : access.status === 'revealed'
            ? 'This one-time ACH approval has already been used.'
            : access.status === 'delivery_failed'
              ? 'The Telegram approval request was not delivered.'
              : 'ACH access request not found.'
    return NextResponse.json(
      { status: access.status, error },
      { status, headers: noStoreHeaders },
    )
  } catch (error) {
    const unauthorized =
      error instanceof Error && error.message === 'Not a client manager'
    const invalid = error instanceof z.ZodError
    return NextResponse.json(
      {
        error: unauthorized
          ? 'Not authorized'
          : invalid
            ? 'Invalid ACH access request.'
            : 'ACH access could not be checked.',
      },
      {
        status: unauthorized ? 403 : invalid ? 400 : 503,
        headers: noStoreHeaders,
      },
    )
  }
}
