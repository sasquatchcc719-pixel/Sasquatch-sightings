import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

/**
 * Daily cron: GPS data housekeeping
 * 1. Abandon stale active shifts (no GPS points for 2+ hours)
 * 2. Prune raw gps_points older than 90 days
 * 3. Roll up any unfinished gps_appointment_visits
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const now = new Date()
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

    // ── 1. Find active shifts with no recent GPS points ───────────────────
    const { data: activeShifts } = await supabase
      .from('gps_shifts')
      .select('id, user_id, started_at')
      .eq('status', 'active')

    let abandoned = 0

    for (const shift of activeShifts ?? []) {
      const { data: recentPoint } = await supabase
        .from('gps_points')
        .select('captured_at')
        .eq('shift_id', shift.id)
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const lastActivity = recentPoint
        ? new Date(recentPoint.captured_at)
        : new Date(shift.started_at)

      if (lastActivity < twoHoursAgo) {
        await supabase
          .from('gps_shifts')
          .update({
            status: 'abandoned',
            ended_at: lastActivity.toISOString(),
          })
          .eq('id', shift.id)
        abandoned++

        console.log(`[gps-cleanup] Abandoned stale shift ${shift.id}`)
      }
    }

    // ── 2. Prune raw GPS points older than 90 days ────────────────────────
    const { error: pruneError, count: pruned } = await supabase
      .from('gps_points')
      .delete({ count: 'exact' })
      .lt('captured_at', ninetyDaysAgo.toISOString())

    if (pruneError) {
      console.error('[gps-cleanup] Prune error:', pruneError)
    }

    // ── 3. Roll up any completed shifts that are missing visit summaries ──
    const { data: completedWithoutVisits } = await supabase
      .from('gps_shifts')
      .select('id')
      .eq('status', 'completed')
      .gte('started_at', ninetyDaysAgo.toISOString())

    let rolledUp = 0
    for (const shift of completedWithoutVisits ?? []) {
      const { data: visits } = await supabase
        .from('gps_appointment_visits')
        .select('id')
        .eq('shift_id', shift.id)
        .limit(1)

      // If no visits but there are on_site points, roll them up now
      if (!visits || visits.length === 0) {
        const { data: onSitePts } = await supabase
          .from('gps_points')
          .select('appointment_id')
          .eq('shift_id', shift.id)
          .eq('segment_type', 'on_site')
          .not('appointment_id', 'is', null)
          .limit(1)

        if (onSitePts && onSitePts.length > 0) {
          await rollUpShiftVisits(supabase, shift.id)
          rolledUp++
        }
      }
    }

    const summary = {
      abandoned,
      prunedPoints: pruned ?? 0,
      rolledUp,
      ranAt: now.toISOString(),
    }

    console.log('[cron/gps-cleanup] Summary:', JSON.stringify(summary))
    return NextResponse.json({ ok: true, summary })
  } catch (error) {
    console.error('[cron/gps-cleanup] Error:', error)
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}

async function rollUpShiftVisits(
  supabase: ReturnType<typeof createAdminClient>,
  shiftId: string,
) {
  const { data: pts } = await supabase
    .from('gps_points')
    .select('appointment_id, captured_at, segment_type')
    .eq('shift_id', shiftId)
    .not('appointment_id', 'is', null)
    .order('captured_at')

  if (!pts) return

  const byAppt = new Map<string, { capturedAt: string; segType: string }[]>()
  for (const pt of pts) {
    if (!pt.appointment_id) continue
    const arr = byAppt.get(pt.appointment_id) ?? []
    arr.push({ capturedAt: pt.captured_at, segType: pt.segment_type })
    byAppt.set(pt.appointment_id, arr)
  }

  for (const [apptId, apptPts] of byAppt.entries()) {
    const onSite = apptPts.filter((p) => p.segType === 'on_site')
    if (onSite.length === 0) continue

    const arrivedAt = onSite[0].capturedAt
    const departedAt = onSite[onSite.length - 1].capturedAt
    const onSiteMs =
      new Date(departedAt).getTime() - new Date(arrivedAt).getTime()

    await supabase.from('gps_appointment_visits').upsert(
      {
        shift_id: shiftId,
        appointment_id: apptId,
        arrived_at: arrivedAt,
        departed_at: departedAt,
        on_site_minutes: Math.round(onSiteMs / 60000),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shift_id,appointment_id' },
    )
  }
}
