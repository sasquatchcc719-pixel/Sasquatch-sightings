import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { trackerTelemetrySchema } from '@/lib/fleet-tracking'

export async function POST(request: NextRequest) {
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
  if (!token)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    return NextResponse.json({ error: 'JSON required' }, { status: 415 })

  // Bound the streamed body too: Content-Length is not trustworthy or always present.
  const reader = request.body?.getReader()
  if (!reader)
    return NextResponse.json({ error: 'Body required' }, { status: 400 })
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 32768) {
      await reader.cancel()
      return NextResponse.json({ error: 'Body too large' }, { status: 413 })
    }
    chunks.push(value)
  }
  let body: unknown
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = trackerTelemetrySchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid telemetry' }, { status: 400 })
  const now = Date.now()
  if (
    parsed.data.points.some(
      (point) => Date.parse(point.recordedAt) > now + 300_000,
    )
  )
    return NextResponse.json(
      { error: 'GPS timestamp is in the future' },
      { status: 400 },
    )
  const { data, error } = await createAdminClient().rpc(
    'ingest_fleet_tracker',
    {
      p_token_hash: createHash('sha256').update(token).digest('hex'),
      p_payload: parsed.data,
    },
  )
  if (error) {
    console.error('[tracker] ingest failed', error.code)
    return NextResponse.json(
      { error: 'Telemetry unavailable' },
      { status: 503 },
    )
  }
  if (data?.error === 'Unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (data?.error === 'Too many requests')
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '2' } },
    )
  if (data?.ok !== true)
    return NextResponse.json(
      { error: 'Telemetry unavailable' },
      { status: 503 },
    )
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
