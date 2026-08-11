import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { listExpenseLines, type QBExpenseLine } from '@/lib/quickbooks-expenses'
import {
  summarizeCanvassLabor,
  type CampaignWindow,
} from '@/lib/ops/channel-pnl'

export const maxDuration = 60

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
  marketingLaborCost: number
  marketingLaborHours: number
  marketingLaborSessions: number
  adCost: number | null
  kept: number
  marginPct: number | null
  costPerJob: number | null
  isCommercial: boolean
}

const DOOR_HANGER_VENDOR = /nextdayflyer|next\s*day\s*flyer/i
const QB_CACHE_MS = 5 * 60_000
let doorHangerPrintCache: { at: number; lines: QBExpenseLine[] } | null = null

const round2 = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100

function dateInWindows(dateKey: string, windows: CampaignWindow[]) {
  return windows.some(
    (window) =>
      dateKey >= window.starts_on &&
      (!window.ends_on || dateKey <= window.ends_on),
  )
}

function sumDoorHangerPrinting(
  lines: QBExpenseLine[],
  windows: CampaignWindow[],
) {
  const unique = new Map(lines.map((line) => [line.key, line]))
  return round2(
    [...unique.values()]
      .filter(
        (line) =>
          DOOR_HANGER_VENDOR.test(`${line.vendor} ${line.memo}`) &&
          dateInWindows(line.date, windows),
      )
      .reduce((sum, line) => sum + Number(line.amount || 0), 0),
  )
}

async function loadDoorHangerPrintLines(force: boolean) {
  if (
    !force &&
    doorHangerPrintCache &&
    Date.now() - doorHangerPrintCache.at < QB_CACHE_MS
  ) {
    return doorHangerPrintCache
  }

  const lines = await listExpenseLines({ since: '2025-01-01' })
  doorHangerPrintCache = { at: Date.now(), lines }
  return doorHangerPrintCache
}

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()

    const { searchParams } = new URL(request.url)
    const forceRefresh = searchParams.get('refresh') === '1'
    const days = Math.min(
      Math.max(Number(searchParams.get('days') || 90), 1),
      1000,
    )
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceKey = since.toISOString().slice(0, 10)
    const todayKey = new Date().toISOString().slice(0, 10)

    // Door hangers are a live campaign tally. Printing comes from QuickBooks;
    // distribution labor comes directly from completed canvass sessions. No
    // stored per-session snapshots are used, so new walks accrue automatically.
    const { data: doorCampaigns, error: campaignError } = await supabase
      .from('marketing_campaigns')
      .select('id, name, starts_on, ends_on')
      .eq('campaign_type', 'door_hanger')
      .eq('status', 'active')
      .lte('starts_on', todayKey)
    if (campaignError) throw campaignError

    const campaignWindows = (doorCampaigns || []).map((campaign) => ({
      starts_on: campaign.starts_on as string,
      ends_on: campaign.ends_on as string | null,
    }))
    const campaignStart = campaignWindows
      .map((window) => window.starts_on)
      .sort()[0]

    const selectedWindows = campaignWindows
      .map((window) => ({
        starts_on: window.starts_on > sinceKey ? window.starts_on : sinceKey,
        ends_on: window.ends_on,
      }))
      .filter((window) => !window.ends_on || window.ends_on >= window.starts_on)

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
      .select('id, user_id, display_name, hourly_rate')
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
          marketingLaborCost: 0,
          marketingLaborHours: 0,
          marketingLaborSessions: 0,
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
          const rate =
            rateByStaffId.get(a.assigned_staff_user_id as string) || 0
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

    let printSource = 'QuickBooks'
    let printRefreshedAt: string | null = null
    let printWarning: string | null = null
    let campaignPrintCost = 0
    let selectedPrintCost = 0

    if (campaignWindows.length) {
      try {
        const printData = await loadDoorHangerPrintLines(forceRefresh)
        printRefreshedAt = new Date(printData.at).toISOString()
        campaignPrintCost = sumDoorHangerPrinting(
          printData.lines,
          campaignWindows,
        )
        selectedPrintCost = sumDoorHangerPrinting(
          printData.lines,
          selectedWindows,
        )
      } catch (quickBooksError) {
        console.error(
          '[channel-pnl] QuickBooks print refresh failed',
          quickBooksError,
        )
        printSource = 'saved QuickBooks links'
        printWarning =
          'QuickBooks could not refresh, so the saved print-cost links are shown.'

        const campaignIds = (doorCampaigns || []).map((campaign) => campaign.id)
        const { data: savedCosts, error: savedCostError } = await supabase
          .from('marketing_campaign_costs')
          .select('id, source_type, source_id, amount, occurred_on')
          .in('campaign_id', campaignIds)
          .in('source_type', ['quickbooks', 'manual'])
        if (savedCostError) throw savedCostError

        const uniqueCosts = new Map(
          (savedCosts || []).map((cost) => [
            `${cost.source_type}:${cost.source_id || cost.id}`,
            cost,
          ]),
        )
        campaignPrintCost = round2(
          [...uniqueCosts.values()]
            .filter(
              (cost) =>
                cost.occurred_on &&
                dateInWindows(cost.occurred_on as string, campaignWindows),
            )
            .reduce((sum, cost) => sum + Number(cost.amount || 0), 0),
        )
        selectedPrintCost = round2(
          [...uniqueCosts.values()]
            .filter(
              (cost) =>
                cost.occurred_on &&
                dateInWindows(cost.occurred_on as string, selectedWindows),
            )
            .reduce((sum, cost) => sum + Number(cost.amount || 0), 0),
        )
      }
    }

    let campaignLabor = summarizeCanvassLabor([], staff || [], campaignWindows)
    let selectedLabor = summarizeCanvassLabor([], staff || [], selectedWindows)
    if (campaignStart) {
      const { data: canvassSessions, error: canvassError } = await supabase
        .from('canvass_sessions')
        .select('id, user_id, started_at, ended_at, status')
        .gte('started_at', `${campaignStart}T00:00:00Z`)
        .eq('status', 'completed')
        .not('ended_at', 'is', null)
      if (canvassError) throw canvassError

      campaignLabor = summarizeCanvassLabor(
        canvassSessions || [],
        staff || [],
        campaignWindows,
      )
      selectedLabor = summarizeCanvassLabor(
        canvassSessions || [],
        staff || [],
        selectedWindows,
      )

      let doorRow = byChannel.get('door_hanger')
      if (!doorRow) {
        doorRow = {
          channel: 'door_hanger',
          jobs: 0,
          revenue: 0,
          laborCost: 0,
          laborHours: 0,
          marketingLaborCost: 0,
          marketingLaborHours: 0,
          marketingLaborSessions: 0,
          adCost: 0,
          kept: 0,
          marginPct: null,
          costPerJob: null,
          isCommercial: false,
        }
        byChannel.set('door_hanger', doorRow)
      }
      doorRow.adCost = selectedPrintCost
      doorRow.marketingLaborCost = selectedLabor.cost
      doorRow.marketingLaborHours = selectedLabor.hours
      doorRow.marketingLaborSessions = selectedLabor.sessions
    }

    const rows = [...byChannel.values()].map((r) => {
      r.revenue = Math.round(r.revenue * 100) / 100
      r.laborCost = Math.round(r.laborCost * 100) / 100
      r.laborHours = Math.round(r.laborHours * 10) / 10
      r.marketingLaborCost = round2(r.marketingLaborCost)
      r.marketingLaborHours = round2(r.marketingLaborHours)
      r.kept = round2(
        r.revenue - r.laborCost - r.marketingLaborCost - (r.adCost || 0),
      )
      r.marginPct =
        r.revenue > 0 ? Math.round((r.kept / r.revenue) * 100) : null
      r.costPerJob =
        r.adCost !== null && r.jobs > 0
          ? round2((r.adCost + r.marketingLaborCost) / r.jobs)
          : null
      return r
    })

    rows.sort((a, b) => b.revenue - a.revenue)

    return NextResponse.json(
      {
        days,
        since: sinceKey,
        updatedAt: new Date().toISOString(),
        rows,
        campaignTallies: campaignStart
          ? [
              {
                channel: 'door_hanger',
                name: 'Door hangers',
                startsOn: campaignStart,
                printingCost: campaignPrintCost,
                marketingLaborCost: campaignLabor.cost,
                marketingLaborHours: campaignLabor.hours,
                marketingLaborSessions: campaignLabor.sessions,
                hourlyRate: campaignLabor.hourlyRate,
                people: campaignLabor.people,
                totalInvested: round2(campaignPrintCost + campaignLabor.cost),
                printSource,
                printRefreshedAt,
                warning: printWarning,
              },
            ]
          : [],
        // Surfaced in the UI so the page never quietly hides what it dropped.
        excluded: { noTiming: skippedNoTiming, overMaxHours: skippedOutlier },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
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
