import { NextResponse } from 'next/server'
import {
  assignedFirmware,
  firmwareHeaders,
  firmwareIdentity,
} from '@/lib/tracker-firmware'

export const maxDuration = 60

export async function GET(request: Request) {
  try {
    const identity = await firmwareIdentity(request)
    if (!identity)
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: firmwareHeaders() },
      )
    const release = await assignedFirmware(identity)
    if (
      !release ||
      new URL(request.url).searchParams.get('release') !== release.id
    )
      return new Response(null, { status: 404, headers: firmwareHeaders() })
    const { data, error } = await identity.db.storage
      .from('tracker-firmware')
      .download(release.storage_path)
    if (error || !data || data.size !== release.size)
      throw new Error('Invalid firmware artifact')
    return new Response(data, {
      headers: {
        ...firmwareHeaders(),
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(data.size),
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'Firmware unavailable' },
      { status: 503, headers: firmwareHeaders() },
    )
  }
}
