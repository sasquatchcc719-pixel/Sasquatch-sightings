'use client'

/**
 * Scan schedule + experiment knobs for both rank scanners.
 *
 * Frequency used to be the only editable field; keyword / density lived as
 * hardcoded defaults ("carpet cleaning", 2mi, 13×13). Those are the actual
 * experiment — so they edit here too. The daily scan-scheduler cron reads
 * scan_schedules.config; a change applies from the next due tick.
 */

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, CalendarClock, AlertTriangle } from 'lucide-react'
import {
  estimateGridCost,
  GRID_KEYWORD_PRESETS,
  LOCAL_FALCON_GRID_SIZES,
  SERVICE_AREA_BUFFER_OPTIONS_MILES,
  SERVICE_AREA_SPACING_OPTIONS_MILES,
} from '@/lib/radar-grid-geo'

/** Local Falcon credits = grid_size² — keep client-side, no API import. */
const lfCredits = (gridSize: number) => gridSize * gridSize

type ScheduleConfig = {
  keyword?: string
  spacing_miles?: number
  buffer_miles?: number
  preset?: string
  grid_size?: number
  radius?: number
  measurement?: string
  lat?: number
  lng?: number
  place_id?: string
  platform?: string
  ai_analysis?: boolean
}

const LF_PLATFORMS = [
  'google',
  'apple',
  'chatgpt',
  'gemini',
  'grok',
  'gaio',
  'aimode',
] as const

type Schedule = {
  id: string
  tool: string
  enabled: boolean
  frequency_days: number
  config: ScheduleConfig | null
  last_run_at: string | null
  last_result: string | null
}

const TOOL_LABEL: Record<string, string> = {
  dataforseo_grid: 'Service-area grid (DataForSEO)',
  local_falcon: 'Local Falcon',
}

function cfg(s: Schedule): ScheduleConfig {
  return s.config && typeof s.config === 'object' ? s.config : {}
}

export function ScanScheduleCard() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [drafts, setDrafts] = useState<Record<string, ScheduleConfig>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/marketing/scan-schedules')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      const rows = (json.schedules ?? []) as Schedule[]
      setSchedules(rows)
      const next: Record<string, ScheduleConfig> = {}
      for (const s of rows) next[s.id] = { ...cfg(s) }
      setDrafts(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (
    id: string,
    patch: {
      enabled?: boolean
      frequency_days?: number
      config?: ScheduleConfig
    },
  ) => {
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

  const setDraft = (id: string, patch: ScheduleConfig) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  return (
    <Card className="border-white/10 bg-white/5 p-4">
      <div className="mb-1 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-white/50" />
        <h3 className="text-sm font-semibold text-white">Scan schedule</h3>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />}
      </div>
      <p className="mb-3 text-xs text-white/40">
        Weekly (or whatever interval) runs for both tools. Set the{' '}
        <span className="text-white/60">same keyword</span> on both for a fair
        A/B — right now they can drift. Changes apply on the next due tick.
      </p>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-3">
        {schedules.map((s) => {
          const draft = drafts[s.id] ?? cfg(s)
          const failed = s.last_result?.startsWith('ERROR')
          const isDfs = s.tool === 'dataforseo_grid'
          const isLf = s.tool === 'local_falcon'
          const spacing = Number(draft.spacing_miles ?? 2)
          const bufferMiles = Number(draft.buffer_miles ?? 0)
          const gridSize = Number(draft.grid_size ?? 13)
          const radius = Number(draft.radius ?? 14)
          const dfsPts = estimateGridCost('service-area', spacing, {
            bufferMiles,
          })
          const keywordListId = `schedule-kw-${s.id}`

          return (
            <div
              key={s.id}
              className="space-y-3 rounded-lg border border-white/10 bg-slate-900/40 px-3 py-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    disabled={savingId === s.id}
                    onChange={(e) => save(s.id, { enabled: e.target.checked })}
                    className="h-4 w-4 accent-emerald-500"
                  />
                  <span className="text-sm font-medium text-white">
                    {TOOL_LABEL[s.tool] ?? s.tool}
                  </span>
                </label>

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
                      if (v && v !== s.frequency_days) {
                        void save(s.id, { frequency_days: v })
                      }
                    }}
                    className="h-8 w-16 text-center"
                  />
                  <span className="text-xs text-white/50">days</span>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
                  Keyword
                  <input
                    list={keywordListId}
                    value={draft.keyword ?? ''}
                    disabled={savingId === s.id}
                    onChange={(e) => setDraft(s.id, { keyword: e.target.value })}
                    className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs normal-case tracking-normal text-white"
                    placeholder="carpet cleaning"
                  />
                  <datalist id={keywordListId}>
                    {GRID_KEYWORD_PRESETS.map((kw) => (
                      <option key={kw} value={kw} />
                    ))}
                  </datalist>
                </label>

                {isDfs && (
                  <>
                    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
                      Spacing
                      <select
                        value={spacing}
                        disabled={savingId === s.id}
                        onChange={(e) =>
                          setDraft(s.id, {
                            spacing_miles: Number(e.target.value),
                          })
                        }
                        className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs normal-case tracking-normal text-white"
                      >
                        {SERVICE_AREA_SPACING_OPTIONS_MILES.map((mi) => (
                          <option key={mi} value={mi}>
                            {mi} mi ·{' '}
                            {estimateGridCost('service-area', mi, {
                              bufferMiles,
                            })}{' '}
                            pts
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
                      Edge buffer
                      <select
                        value={bufferMiles}
                        disabled={savingId === s.id}
                        onChange={(e) =>
                          setDraft(s.id, {
                            buffer_miles: Number(e.target.value),
                          })
                        }
                        className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs normal-case tracking-normal text-white"
                      >
                        {SERVICE_AREA_BUFFER_OPTIONS_MILES.map((mi) => (
                          <option key={mi} value={mi}>
                            {mi === 0 ? '0 mi · clip tight' : `${mi} mi outside`} ·{' '}
                            {estimateGridCost('service-area', spacing, {
                              bufferMiles: mi,
                            })}{' '}
                            pts
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}

                {isLf && (
                  <>
                    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
                      Grid size
                      <select
                        value={gridSize}
                        disabled={savingId === s.id}
                        onChange={(e) =>
                          setDraft(s.id, { grid_size: Number(e.target.value) })
                        }
                        className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs normal-case tracking-normal text-white"
                      >
                        {LOCAL_FALCON_GRID_SIZES.map((n) => (
                          <option key={n} value={n}>
                            {n}×{n} · {lfCredits(n)} credits
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
                      Radius (mi)
                      <Input
                        type="number"
                        min={0.5}
                        max={50}
                        step={0.5}
                        value={radius}
                        disabled={savingId === s.id}
                        onChange={(e) =>
                          setDraft(s.id, { radius: Number(e.target.value) })
                        }
                        className="h-8 w-20"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
                      Platform
                      <select
                        value={draft.platform ?? 'google'}
                        disabled={savingId === s.id}
                        onChange={(e) =>
                          setDraft(s.id, { platform: e.target.value })
                        }
                        className="rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 text-xs normal-case tracking-normal text-white"
                      >
                        {LF_PLATFORMS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex w-[6.5rem] flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
                      Center lat
                      <Input
                        type="number"
                        step={0.0001}
                        value={draft.lat ?? ''}
                        disabled={savingId === s.id}
                        onChange={(e) =>
                          setDraft(s.id, { lat: Number(e.target.value) })
                        }
                        className="h-8 font-mono"
                      />
                    </label>
                    <label className="flex w-[6.5rem] flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
                      Center lng
                      <Input
                        type="number"
                        step={0.0001}
                        value={draft.lng ?? ''}
                        disabled={savingId === s.id}
                        onChange={(e) =>
                          setDraft(s.id, { lng: Number(e.target.value) })
                        }
                        className="h-8 font-mono"
                      />
                    </label>
                    <label className="flex items-center gap-2 pb-1 text-xs text-white/70">
                      <input
                        type="checkbox"
                        checked={Boolean(draft.ai_analysis ?? true)}
                        disabled={savingId === s.id}
                        onChange={(e) =>
                          setDraft(s.id, { ai_analysis: e.target.checked })
                        }
                        className="accent-sky-500"
                      />
                      AI analysis
                    </label>
                  </>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  disabled={savingId === s.id || !(draft.keyword ?? '').trim()}
                  onClick={() => {
                    const config: ScheduleConfig = {
                      keyword: (draft.keyword ?? '').trim(),
                    }
                    if (isDfs) {
                      config.spacing_miles = spacing
                      config.buffer_miles = bufferMiles
                      config.preset =
                        draft.preset === 'tri-lakes' ? 'tri-lakes' : 'service-area'
                    }
                    if (isLf) {
                      config.grid_size = gridSize
                      config.radius = radius
                      config.measurement = draft.measurement === 'km' ? 'km' : 'mi'
                      config.platform = draft.platform ?? 'google'
                      config.ai_analysis = Boolean(draft.ai_analysis ?? true)
                      if (draft.place_id) config.place_id = draft.place_id
                      if (draft.lat != null && Number.isFinite(draft.lat)) {
                        config.lat = draft.lat
                      }
                      if (draft.lng != null && Number.isFinite(draft.lng)) {
                        config.lng = draft.lng
                      }
                    }
                    void save(s.id, { config })
                  }}
                >
                  {savingId === s.id ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Save settings
                </Button>
              </div>

              <p className="font-mono text-[10px] text-white/35">
                {isDfs && (
                  <>
                    next run ≈ {dfsPts} pts @ {spacing} mi
                    {bufferMiles > 0 ? ` + ${bufferMiles} mi edge` : ''} · &quot;
                    {draft.keyword || '—'}&quot;
                  </>
                )}
                {isLf && (
                  <>
                    next run ≈ {gridSize}×{gridSize} ({lfCredits(gridSize)} credits) ·{' '}
                    {radius}
                    {draft.measurement === 'km' ? 'km' : 'mi'} ·{' '}
                    {draft.platform || 'google'} · &quot;
                    {draft.keyword || '—'}&quot;
                  </>
                )}
                {' · '}last run:{' '}
                {s.last_run_at
                  ? new Date(s.last_run_at).toLocaleString()
                  : 'never'}
                {s.last_result && (
                  <span className={failed ? ' text-red-300' : ''}>
                    {' '}
                    · {s.last_result}
                  </span>
                )}
              </p>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
