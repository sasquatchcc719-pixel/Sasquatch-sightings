import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * Channel P&L — what each lead source actually earns after ads and labor.
 *
 * Three deliberate modeling choices, all of which change the numbers:
 *
 * 1. Job duration is the `on_my_way` status event → `completed_at`, NOT
 *    arrived_at/job_started_at (those are populated on <1% of rows). It includes
 *    drive time on purpose — that time is paid either way.
 * 2. Only David's hours are a cost. Charles is the owner; his time is not an
 *    expense line, so his jobs carry zero labor. Rates come from
 *    staff_users.hourly_rate so a raise is a single edit.
 * 3. Ad spend is per-channel-per-month from channel_ad_costs. Channels with no
 *    row are reported with adCost = null (unknown), never 0 — showing an
 *    untracked channel as "free" is what made Nextdoor look better than LSA.
 */

// Jobs longer than this are forgot-to-close records, not real work.
const MAX_JOB_HOURS = 12

// Commercial/recurring work behaves nothing like residential and distorts every
// per-job average, so it is reported on its own line rather than mixed in.
const COMMERCIAL_SOURCES = new Set(['other'])

type ChannelRow = {
  channel: string
  jobs: number
  revenue: number
  laborCost: number
  laborHours: number
  adCost: number | null
  kept: number
  marginPct: number | null
  costPerJob: number | null
  isCommercial: boolean
}

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()

    const { searchParams } = new URL(request.url)
    const days = Math.min(
      Math.max(Number(searchParams.get('days') || 90), 1),
      1000,
    )
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceKey = since.toISOString().slice(0, 10)

    // ── Job duration: earliest on_my_way per appointment ──────────────────
    const { data: omwEvents, error: omwError } = await supabase
      .from('ops_appointment_status_events')
      .select('appointment_id, created_at')
      .eq('to_status', 'on_my_way')
    if (omwError) throw omwError

    const omwByAppointment = new Map<string, string>()
    for (const e of omwEvents || []) {
      const id = e.appointment_id as string
      const at = e.created_at as string
      const existing = omwByAppointment.get(id)
      if (!existing || at < existing) omwByAppointment.set(id, at)
    }

    // ── Who is paid, and how much ─────────────────────────────────────────
    const { data: staff, error: staffError } = await supabase
      .from('staff_users')
      .select('id, display_name, hourly_rate')
    if (staffError) throw staffError

    const rateByStaffId = new Map<string, number>()
    for (const s of staff || []) {
      rateByStaffId.set(s.id as string, Number(s.hourly_rate || 0))
    }

    // ── Completed jobs in range ───────────────────────────────────────────
    const { data: appts, error: apptError } = await supabase
      .from('ops_appointments')
      .select(
        'id, appointment_date, completed_at, quoted_total, lead_source_key, assigned_staff_user_id',
      )
      .gte('appointment_date', sinceKey)
      .not('completed_at', 'is', null)
    if (apptError) throw apptError

    const byChannel = new Map<string, ChannelRow>()
    let skippedNoTiming = 0
    let skippedOutlier = 0

    for (const a of appts || []) {
      const revenue = Number(a.quoted_total || 0)
      // $0 rows are recurring placeholders, not jobs — they drag every average down.
      if (revenue <= 0) continue

      const channel = (a.lead_source_key as string) || 'unknown'
      const row =
        byChannel.get(channel) ||
        ({
          channel,
          jobs: 0,
          revenue: 0,
          laborCost: 0,
          laborHours: 0,
          adCost: null,
          kept: 0,
          marginPct: null,
          costPerJob: null,
          isCommercial: COMMERCIAL_SOURCES.has(channel),
        } as ChannelRow)

      row.jobs += 1
      row.revenue += revenue

      const omwAt = omwByAppointment.get(a.id as string)
      if (omwAt && a.completed_at) {
        const hours =
          (new Date(a.completed_at as string).getTime() -
            new Date(omwAt).getTime()) /
          3_600_000
        if (hours >= 0 && hours <= MAX_JOB_HOURS) {
          const rate = rateByStaffId.get(a.assigned_staff_user_id as string) || 0
          row.laborHours += hours
          row.laborCost += hours * rate
        } else {
          skippedOutlier += 1
        }
      } else {
        skippedNoTiming += 1
      }

      byChannel.set(channel, row)
    }

    // ── Ad spend per channel over the same window ─────────────────────────
    const { data: adCosts, error: adError } = await supabase
      .from('channel_ad_costs')
      .select('channel, month, amount')
      .gte('month', sinceKey.slice(0, 8) + '01')
    if (adError) throw adError

    for (const c of adCosts || []) {
      const row = byChannel.get(c.channel as string)
      if (!row) continue
      row.adCost = (row.adCost || 0) + Number(c.amount || 0)
    }

    const rows = [...byChannel.values()].map((r) => {
      r.revenue = Math.round(r.revenue * 100) / 100
      r.laborCost = Math.round(r.laborCost * 100) / 100
      r.laborHours = Math.round(r.laborHours * 10) / 10
      r.kept =
        Math.round((r.revenue - r.laborCost - (r.adCost || 0)) * 100) / 100
      r.marginPct = r.revenue > 0 ? Math.round((r.kept / r.revenue) * 100) : null
      r.costPerJob =
        r.adCost !== null && r.jobs > 0
          ? Math.round((r.adCost / r.jobs) * 100) / 100
          : null
      return r
    })

    rows.sort((a, b) => b.revenue - a.revenue)

    return NextResponse.json({
      days,
      since: sinceKey,
      rows,
      // Surfaced in the UI so the page never quietly hides what it dropped.
      excluded: { noTiming: skippedNoTiming, overMaxHours: skippedOutlier },
    })
  } catch (error) {
    console.error('[admin/marketing/channel-pnl][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: 'Failed to load channel P&L' },
      { status },
    )
  }
}
