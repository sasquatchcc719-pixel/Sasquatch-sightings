import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/supabase/server'
import {
  bridgeActionSchema,
  bridgeAuthorized,
  handleMeasurementAction,
  MeasurementError,
} from '@/lib/outreach/measurements'

export const maxDuration = 30
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
}
export async function POST(request: NextRequest) {
  const secret = process.env.OUTREACH_BRIDGE_SECRET
  if (!bridgeAuthorized(request.headers.get('authorization'), secret))
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401, headers },
    )
  try {
    if (Number(request.headers.get('content-length')) > 40000)
      return NextResponse.json(
        { error: 'Request too large' },
        { status: 413, headers },
      )
    const chunks: Uint8Array[] = []
    let size = 0
    const reader = request.body?.getReader()
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 40000) {
            await reader.cancel()
            return NextResponse.json(
              { error: 'Request too large' },
              { status: 413, headers },
            )
          }
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }
    }
    const raw = Buffer.concat(chunks).toString('utf8')
    const action = bridgeActionSchema.parse(JSON.parse(raw))
    const result = await handleMeasurementAction(
      createAdminClient(),
      action,
      secret!,
      process.env.OUTREACH_MEASUREMENT_WRITES_ENABLED === 'true',
    )
    return NextResponse.json(result, { headers })
  } catch (error) {
    if (error instanceof MeasurementError)
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          ...(error.details ? { details: error.details } : {}),
        },
        { status: error.status, headers },
      )
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return NextResponse.json(
        {
          error: 'Check the measuring appointment details',
          code: 'INVALID_INPUT',
        },
        { status: 400, headers },
      )
    // Never include tokens, request bodies, or customer contact data in logs.
    console.error('[outreach/measurements] Internal bridge failure')
    return NextResponse.json(
      {
        error:
          'Measuring integration unavailable; recover the operation status before retrying',
        code: 'BRIDGE_UNAVAILABLE',
      },
      { status: 503, headers },
    )
  }
}
