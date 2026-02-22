/**
 * Public stats API for external readers (e.g. Gemini hiring trigger check).
 * Returns utilization rate, average weekly revenue, and consecutive weeks goal met.
 * No authentication — data is read-only and limited to these three figures.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

const DEFAULT_SETTINGS = {
  annual_revenue_goal: 150000,
  available_hours_per_week: 40,
  work_weeks_per_year: 48,
  hiring_threshold: 4000,
  hiring_consecutive_weeks: 4,
}

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Get first user's settings (single-tenant: one business)
    const { data: settingsRow } = await supabase
      .from('settings')
      .select('*')
      .limit(1)
      .single()

    const userSettings = settingsRow
      ? {
          ...DEFAULT_SETTINGS,
          ...settingsRow,
          hiring_threshold:
            settingsRow.hiring_threshold ?? DEFAULT_SETTINGS.hiring_threshold,
          hiring_consecutive_weeks:
            settingsRow.hiring_consecutive_weeks ??
            DEFAULT_SETTINGS.hiring_consecutive_weeks,
        }
      : DEFAULT_SETTINGS

    const userId = settingsRow?.user_id ?? null

    // Jobs with revenue/hours
    const { data: jobs } = await supabase
      .from('jobs')
      .select('invoice_amount, hours_worked, created_at')
      .not('invoice_amount', 'is', null)
      .not('hours_worked', 'is', null)
      .order('created_at', { ascending: false })

    // Revenue entries for the settings owner (if we have one)
    let entries: {
      invoice_amount: number
      hours_worked: number
      entry_date: string
    }[] = []
    if (userId) {
      const { data: rev } = await supabase
        .from('revenue_entries')
        .select('invoice_amount, hours_worked, entry_date')
        .eq('user_id', userId)
        .order('entry_date', { ascending: false })
      entries = rev ?? []
    }

    const allRevenue = [
      ...(jobs || []).map((j) => ({
        invoice_amount: j.invoice_amount as number,
        hours_worked: j.hours_worked as number,
        date: j.created_at,
      })),
      ...entries.map((e) => ({
        invoice_amount: e.invoice_amount,
        hours_worked: e.hours_worked,
        date: e.entry_date,
      })),
    ]

    const now = new Date()
    const startOfYear = new Date(now.getFullYear(), 0, 1)
    const ytdData = allRevenue.filter(
      (item) => new Date(item.date) >= startOfYear,
    )

    const ytdRevenue = ytdData.reduce(
      (sum, item) => sum + (item.invoice_amount || 0),
      0,
    )
    const ytdHours = ytdData.reduce(
      (sum, item) => sum + (item.hours_worked || 0),
      0,
    )

    const weeksElapsed = Math.ceil(
      (now.getTime() - startOfYear.getTime()) / (7 * 24 * 60 * 60 * 1000),
    )
    const availableHoursYTD =
      weeksElapsed * userSettings.available_hours_per_week
    const utilizationRate =
      availableHoursYTD > 0
        ? Math.round((ytdHours / availableHoursYTD) * 100)
        : 0

    const averageWeeklyRevenue =
      weeksElapsed > 0 ? Math.round(ytdRevenue / weeksElapsed) : 0

    // Consecutive weeks meeting hiring threshold (same logic as stats page)
    const getMonday = (d: Date) => {
      const date = new Date(d)
      const day = date.getDay()
      const diff = date.getDate() - day + (day === 0 ? -6 : 1)
      date.setDate(diff)
      date.setHours(0, 0, 0, 0)
      return date
    }

    const hiringThreshold = userSettings.hiring_threshold
    const currentMonday = getMonday(now)
    const recentWeeks: { revenue: number; meetsThreshold: boolean }[] = []

    for (let i = 0; i < 8; i++) {
      const weekStart = new Date(currentMonday)
      weekStart.setDate(weekStart.getDate() - i * 7)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 6)
      weekEnd.setHours(23, 59, 59, 999)

      const weekData = allRevenue.filter((item) => {
        const itemDate = new Date(item.date)
        return itemDate >= weekStart && itemDate <= weekEnd
      })
      const weekRevenue = weekData.reduce(
        (sum, item) => sum + (item.invoice_amount || 0),
        0,
      )
      recentWeeks.push({
        revenue: weekRevenue,
        meetsThreshold: weekRevenue >= hiringThreshold,
      })
    }

    let consecutiveWeeksGoalMet = 0
    const startIndex = recentWeeks[0].meetsThreshold ? 0 : 1
    for (let i = startIndex; i < recentWeeks.length; i++) {
      if (recentWeeks[i].meetsThreshold) {
        consecutiveWeeksGoalMet++
      } else {
        break
      }
    }

    return NextResponse.json(
      {
        utilizationRate,
        averageWeeklyRevenue,
        consecutiveWeeksGoalMet,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        },
      },
    )
  } catch (error) {
    console.error('[stats/public] Error:', error)
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 })
  }
}
