'use client'

import { useEffect, useState } from 'react'
import { GridHeatMap } from '@/components/admin/radar/GridHeatMap'
import { ScanScheduleCard } from '@/components/admin/radar/ScanScheduleCard'
import {
  ReportShell,
  SettingsPanel,
} from '@/components/admin/telegram/ReportShell'

type Scan = {
  id: string
  keyword: string
  points_scanned: number
  points_ranked: number
  avg_rank: number | null
  visibility_pct: number | null
  status: string
  completed_at: string | null
  created_at: string
}

export default function TelegramGridPage() {
  const [scan, setScan] = useState<Scan | null>(null)

  useEffect(() => {
    fetch('/api/admin/radar/grid', { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json()
        setScan(json.scan ?? json.scans?.[0] ?? null)
      })
      .catch(() => setScan(null))
  }, [])

  const message = scan
    ? `Rank scans\n${scan.status === 'complete' || scan.status === 'completed' ? 'dataforseo_grid fired' : scan.status}\n${scan.keyword}: ${scan.points_ranked}/${scan.points_scanned} points ranked · visibility ${scan.visibility_pct ?? '—'}% · typical rank ${scan.avg_rank ?? '—'}`
    : 'Rank scans\nNothing due — no ping sent.'

  return (
    <ReportShell
      kicker="Telegram channel"
      title="Radar grid"
      lede="Many pins across the service area. Telegram today only says the scan fired. The map is the real report — this is the overhaul waiting on how you want that message to read."
      when="7:00am, only when a scan is due"
      lastSent={
        scan?.completed_at
          ? new Date(scan.completed_at).toLocaleString('en-US', {
              timeZone: 'America/Denver',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })
          : null
      }
      message={message}
      settings={
        <SettingsPanel
          title="Cadence lives on the map"
          hint="Keyword, miles between pins, edge buffer, Google vs AI Mode, and how often it runs are on the cards below. Telegram still only says the scan fired — grid numbers are the next overhaul."
        >
          <p className="text-sm leading-6 text-white/60">
            A daily check at 7:00am costs nothing if nothing is due. Turn a tool
            off if you want silence.
          </p>
        </SettingsPanel>
      }
    >
      <ScanScheduleCard />
      <GridHeatMap />
    </ReportShell>
  )
}
