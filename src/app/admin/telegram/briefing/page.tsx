'use client'

import { useEffect, useState } from 'react'
import { WeeklyRollupView } from '@/components/admin/marketing/WeeklyRollupView'
import {
  ReportShell,
  SettingsPanel,
} from '@/components/admin/telegram/ReportShell'
import { Loader2 } from 'lucide-react'

export default function TelegramBriefingPage() {
  const [digest, setDigest] = useState<string | null>(null)
  const [week, setWeek] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/comms/telegram/briefing', { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        setDigest(json.digest)
        setWeek(json.weekStart)
      })
      .catch(() => setDigest(null))
  }, [])

  return (
    <ReportShell
      kicker="Telegram channel"
      title="Weekly briefing"
      lede="Jobs, Google visits, quotes, and reconciled spend for the completed week. Town filters and date range below change the dashboard, not the Monday text."
      when="Mondays at 9:30am"
      lastSent={week ? `Week of ${week}` : null}
      message={digest}
      settings={
        <SettingsPanel
          title="What feeds it"
          hint="The briefing is assembled from work already in Sightings. Change the sources, not a copy-paste."
        >
          <ul className="space-y-3 text-sm leading-5 text-white/65">
            <li>
              <span className="text-white">Towns</span> — active service areas
              in the geo list. A town with no jobs, spend, or search that week
              is omitted from Telegram.
            </li>
            <li>
              <span className="text-white">Spend</span> — QuickBooks marketing
              lines plus campaign costs on Marketing → Campaigns.
            </li>
            <li>
              <span className="text-white">Maps check</span> — last Radar grid
              sample for that town, if one exists.
            </li>
          </ul>
        </SettingsPanel>
      }
    >
      {digest === undefined ? (
        <Loader2 className="h-6 w-6 animate-spin text-white/40" />
      ) : null}
      <WeeklyRollupView embedded />
    </ReportShell>
  )
}
