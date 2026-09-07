import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  getNextdoorPublicMetrics,
  parseNextdoorMetricsInput,
  saveNextdoorPublicMetrics,
} from '@/lib/nextdoor-stats'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const metrics = await getNextdoorPublicMetrics(createAdminClient())
    return NextResponse.json(metrics)
  } catch (error) {
    console.error('[admin/marketing/nextdoor-stats GET]', error)
    return NextResponse.json(
      { error: 'Unable to load metrics' },
      { status: 500 },
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const body = (await request.json()) as Record<string, unknown>
    const parsed = parseNextdoorMetricsInput(
      `${body.faves ?? ''} ${body.recommendations ?? ''} ${body.mentions ?? ''} ${body.pageViews ?? ''}`,
    )

    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.message }, { status: 400 })
    }

    const metrics = await saveNextdoorPublicMetrics({
      supabase: createAdminClient(),
      counts: parsed.counts,
      source: 'owner_admin',
    })
    return NextResponse.json(metrics)
  } catch (error) {
    console.error('[admin/marketing/nextdoor-stats PUT]', error)
    return NextResponse.json(
      { error: 'Unable to save metrics' },
      { status: 500 },
    )
  }
}
