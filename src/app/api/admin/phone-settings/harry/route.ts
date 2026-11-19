import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole } from '@/lib/auth'
import {
  getHarrySettings,
  harryPreviewReady,
  harryPublicReady,
  normalizeHarryCell,
  setHarryPreview,
  setHarryPublic,
} from '@/lib/twilio/harry-access'

async function authorized() {
  const { user, role } = await getUserWithRole()
  return Boolean(user && (role === 'admin' || role === 'owner'))
}

export async function GET() {
  if (!(await authorized()))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await getHarrySettings())
  } catch {
    return NextResponse.json(
      { error: 'Could not load Harry’s phone settings.' },
      { status: 503 },
    )
  }
}

export async function PUT(request: NextRequest) {
  if (!(await authorized()))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  try {
    if (body?.action === 'start-preview') {
      if (!harryPreviewReady())
        return NextResponse.json(
          { error: 'Voice setup must be completed before starting a preview.' },
          { status: 409 },
        )
      const phone = normalizeHarryCell(body.phone)
      if (!phone)
        return NextResponse.json(
          { error: 'Enter a valid cell number.' },
          { status: 400 },
        )
      await setHarryPreview(phone)
    } else if (body?.action === 'stop-preview') {
      await setHarryPreview(null)
    } else if (
      body?.action === 'set-public' &&
      typeof body.enabled === 'boolean'
    ) {
      if (body.enabled && !harryPublicReady()) {
        return NextResponse.json(
          { error: 'Public answering is locked during the private pilot.' },
          { status: 409 },
        )
      }
      await setHarryPublic(body.enabled)
    } else {
      return NextResponse.json({ error: 'Invalid setting.' }, { status: 400 })
    }
    return NextResponse.json(await getHarrySettings())
  } catch {
    return NextResponse.json(
      {
        error:
          'Could not confirm the saved setting. Refresh to check its status.',
      },
      { status: 503 },
    )
  }
}
