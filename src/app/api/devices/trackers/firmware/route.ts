import { NextResponse } from 'next/server'
import {
  assignedFirmware,
  firmwareHeaders,
  firmwareIdentity,
  firmwareReportSchema,
} from '@/lib/tracker-firmware'


export async function GET(request: Request) {
  try {
    const identity = await firmwareIdentity(request)
    if (!identity)
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: firmwareHeaders() },
      )
    const release = await assignedFirmware(identity)
    if (!release)
      return new Response(null, { status: 204, headers: firmwareHeaders() })
    const { storage_path: _path, ...manifest } = release
    return NextResponse.json(manifest, { headers: firmwareHeaders() })
  } catch {
    return NextResponse.json(
      { error: 'Firmware unavailable' },
      { status: 503, headers: firmwareHeaders() },
    )
  }
}

export async function POST(request: Request) {
  try {
    const identity = await firmwareIdentity(request)
    if (!identity)
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: firmwareHeaders() },
      )
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return new Response(null, { status: 415 })
    const reader = request.body?.getReader()
    let text = ''
    if (!reader) return new Response(null, { status: 400 })
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 512) {
        await reader.cancel()
        return new Response(null, { status: 413 })
      }
      chunks.push(part.value)
    }
    text = Buffer.concat(chunks).toString('utf8')
    let input: unknown
    try {
      input = JSON.parse(text)
    } catch {
      return new Response(null, { status: 400 })
    }
    const report = firmwareReportSchema.safeParse(input)
    if (!report.success) return new Response(null, { status: 400 })
    const { error } = await identity.db.from('fleet_tracker_firmware').upsert(
      {
        tracker_id: identity.trackerId,
        reported_version: report.data.version,
        reported_sequence: report.data.sequence,
        state: report.data.state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tracker_id' },
    )
    if (error) throw error
    return NextResponse.json({ ok: true }, { headers: firmwareHeaders() })
  } catch {
    return NextResponse.json(
      { error: 'Firmware unavailable' },
      { status: 503, headers: firmwareHeaders() },
    )
  }
}
