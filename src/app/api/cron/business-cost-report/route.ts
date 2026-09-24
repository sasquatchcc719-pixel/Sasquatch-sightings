import { NextRequest, NextResponse } from 'next/server'
import {
  buildBusinessCostReportCard,
  buildBusinessCostDigest,
  loadBusinessCostSnapshots,
  refreshBusinessCostSnapshots,
  weeklyCostWindowsSince,
  yearToDateCostWindow,
} from '@/lib/ops/business-economics'
import { deliverReportCard } from '@/lib/reports/telegram-report'
import { sendTelegramNotification } from '@/lib/telegram'
import { createAdminClient } from '@/supabase/server'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const windows = weeklyCostWindowsSince().slice(-8)
    const refreshed = await refreshBusinessCostSnapshots(
      supabase,
      windows,
      'weekly',
    )
    const [yearToDate] = await refreshBusinessCostSnapshots(
      supabase,
      [yearToDateCostWindow()],
      'year_to_date',
    )
    const snapshots = await loadBusinessCostSnapshots(supabase, 'weekly')
    const digest = buildBusinessCostDigest(snapshots, yearToDate || null)
    const report = buildBusinessCostReportCard(snapshots, yearToDate || null)
    if (!report) {
      throw new Error('No weekly business cost snapshot available')
    }
    const delivery = await deliverReportCard({
      supabase,
      slug: 'business-cost-weekly',
      runKey: report.runKey,
      card: report.card,
      caption: report.caption,
      text: digest,
    })
    if (!delivery.textSent) {
      return NextResponse.json(
        { error: 'Cost report built, but Telegram delivery failed' },
        { status: 502 },
      )
    }
    return NextResponse.json({
      ok: true,
      refreshed: refreshed.length,
      latestWindow: refreshed.at(-1)?.windowEnd || null,
      yearToDateThrough: yearToDate?.windowEnd || null,
      imageSent: delivery.imageSent,
      imageUrl: delivery.imageUrl,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Business cost report failed'
    console.error('[cron/business-cost-report]', error)
    await sendTelegramNotification(
      `Business Cost Report FAILED — no cost update this week.\nError: ${message}`,
      { disablePreview: true },
    )
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
