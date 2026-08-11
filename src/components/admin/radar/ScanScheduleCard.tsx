'use client'

/**
 * Scan frequency settings — the knob that used to be a hardcoded cron entry.
 *
 * Both scanners (our DataForSEO grid and Local Falcon) are fired by one daily
 * scheduler that reads scan_schedules; this card edits that table. Changing
 * "7" to "3" here makes both the next tick's business — no deploy.
 */

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Loader2, CalendarClock, AlertTriangle } from 'lucide-react'

type Schedule = {
  id: string
  tool: string
  enabled: boolean
  frequency_days: number
  last_run_at: string | null
  last_result: string | null
}

const TOOL_LABEL: Record<string, { name: string; note: string }> = {
  dataforseo_grid: {
    name: 'Service-area grid (DataForSEO)',
    note: '141 points @ 2mi · ~$0.28/scan',
  },
  local_falcon: {
    name: 'Local Falcon 13×13',
    note: '169 credits/scan of 7,500/mo',
  },
}

export function ScanScheduleCard() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/marketing/scan-schedules')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setSchedules(json.schedules ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (id: string, patch: { enabled?: boolean; frequency_days?: number }) => {
    setSavingId(id)
    setError(null)
    try {
      const res = await fetch('/api/admin/marketing/scan-schedules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to save')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Card className="border-white/10 bg-white/5 p-4">
      <div className="mb-1 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-white/50" />
        <h3 className="text-sm font-semibold text-white">Scan schedule</h3>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />}
      </div>
      <p className="mb-3 text-xs text-white/40">
        A daily scheduler fires whichever scans are due. Edit the interval here —
        it applies from the next morning tick, no deploy.
      </p>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-2">
        {schedules.map((s) => {
          const meta = TOOL_LABEL[s.tool] ?? { name: s.tool, note: '' }
          const failed = s.last_result?.startsWith('ERROR')
          return (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-slate-900/40 px-3 py-2"
            >
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  disabled={savingId === s.id}
                  onChange={(e) => save(s.id, { enabled: e.target.checked })}
                  className="h-4 w-4 accent-emerald-500"
                />
                <span className="text-sm font-medium text-white">{meta.name}</span>
              </label>
              <span className="font-mono text-[10px] text-white/40">{meta.note}</span>

              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-white/50">every</span>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  defaultValue={s.frequency_days}
                  disabled={savingId === s.id}
                  onBlur={(e) => {
                    const v = Math.floor(Number(e.target.value))
                    if (v && v !== s.frequency_days) save(s.id, { frequency_days: v })
                  }}
                  className="h-8 w-16 text-center"
                />
                <span className="text-xs text-white/50">days</span>
              </div>

              <div className="w-full font-mono text-[10px] text-white/35">
                last run:{' '}
                {s.last_run_at
                  ? new Date(s.last_run_at).toLocaleString()
                  : 'never'}
                {s.last_result && (
                  <span className={failed ? 'text-red-300' : ''}>
                    {' '}· {s.last_result}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
