import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { approveDraft } from '@/lib/echo/enqueue'

type Params = { params: Promise<{ id: string }> }

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const { id } = await params

    const results = await approveDraft(id)
    const anySuccess = results.some((r) => r.status === 'success')
    const allFailed =
      results.length > 0 && results.every((r) => r.status === 'failed')

    if (allFailed) {
      return NextResponse.json(
        {
          error: 'All enabled channels failed to post.',
          channels: results,
        },
        { status: 502 },
      )
    }

    return NextResponse.json({
      ok: anySuccess,
      channels: results,
    })
  } catch (err) {
    console.error('[social-post-drafts POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to post draft' },
      { status: 500 },
    )
  }
}
