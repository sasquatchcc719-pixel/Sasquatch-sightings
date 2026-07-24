'use client'

/**
 * Start-of-day check-in: pick an asset, punch in the odometer/engine hours,
 * done. Designed to take ten seconds standing next to the van.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Check,
  Gauge,
  Loader2,
  Wrench,
  X as XIcon,
} from 'lucide-react'

type Asset = {
  id: string
  name: string
  asset_type: string
  meter_type: 'miles' | 'hours' | 'none'
  current_meter: number | null
  image_url: string | null
}

type MaintenanceTask = {
  id: string
  asset_id: string
  title: string
  status: string
  meter_at_trigger: number | null
  triggered_at: string
  asset_name: string
  meter_type: string
}

export default function CheckinPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Asset | null>(null)
  const [reading, setReading] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [tasks, setTasks] = useState<MaintenanceTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [taskBusyId, setTaskBusyId] = useState<string | null>(null)

  const loadTasks = () => {
    setTasksLoading(true)
    fetch('/api/field/maintenance', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setTasks(data.tasks ?? []))
      .finally(() => setTasksLoading(false))
  }

  useEffect(() => {
    fetch('/api/field/fleet', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) =>
        setAssets(
          (data.assets ?? []).filter((a: Asset) => a.meter_type !== 'none'),
        ),
      )
      .finally(() => setLoading(false))
    loadTasks()
  }, [])

  const resolveTask = async (
    taskId: string,
    action: 'complete' | 'dismiss',
  ) => {
    setTaskBusyId(taskId)
    try {
      const res = await fetch('/api/field/maintenance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action }),
      })
      if (res.ok) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
      }
    } finally {
      setTaskBusyId(null)
    }
  }

  const save = async () => {
    if (!selected || !reading.trim()) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const res = await fetch('/api/field/fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: selected.id,
          reading: Number(reading),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      setDone(`${selected.name} logged at ${reading} ${selected.meter_type}.`)
      setAssets((prev) =>
        prev.map((a) =>
          a.id === selected.id ? { ...a, current_meter: Number(reading) } : a,
        ),
      )
      setSelected(null)
      setReading('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100">
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center gap-3">
          <Link href="/field" className="text-slate-400 hover:text-white">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Gauge className="h-5 w-5" /> ⚙️ Gears
          </h1>
        </div>

        {done ? (
          <p className="flex items-center gap-2 rounded-lg bg-green-950/60 px-3 py-2 text-sm text-green-400">
            <Check className="h-4 w-4" /> {done}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        ) : null}

        {!tasksLoading && tasks.length > 0 ? (
          <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-300">
              <Wrench className="h-4 w-4" /> Maintenance due ({tasks.length})
            </p>
            <div className="space-y-2">
              {tasks.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 rounded-lg bg-black/20 p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {t.title}
                    </p>
                    <p className="text-xs text-slate-400">{t.asset_name}</p>
                  </div>
                  <button
                    type="button"
                    disabled={taskBusyId === t.id}
                    onClick={() => resolveTask(t.id, 'dismiss')}
                    title="Not now"
                    className="rounded-lg bg-white/10 p-2 hover:bg-white/20 disabled:opacity-40"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={taskBusyId === t.id}
                    onClick={() => resolveTask(t.id, 'complete')}
                    title="Done"
                    className="rounded-lg bg-green-600 p-2 hover:bg-green-500 disabled:opacity-40"
                  >
                    {taskBusyId === t.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : assets.length === 0 ? (
          <p className="rounded-xl bg-white/5 p-4 text-sm text-slate-400">
            No assets set up yet — Charles adds them under Admin → Fleet.
          </p>
        ) : (
          <div className="space-y-2">
            {assets.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setSelected(a)
                  setReading('')
                  setDone(null)
                }}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${
                  selected?.id === a.id
                    ? 'border-green-500 bg-green-500/10'
                    : 'border-white/10 bg-white/5'
                }`}
              >
                {a.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.image_url}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-lg object-cover"
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-slate-400">
                    {a.current_meter != null
                      ? `Last: ${a.current_meter} ${a.meter_type}`
                      : `No reading yet (${a.meter_type})`}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {selected ? (
          <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4">
            <label className="text-sm">
              {selected.name} —{' '}
              {selected.meter_type === 'hours'
                ? 'engine hours'
                : 'odometer miles'}
            </label>
            <input
              type="number"
              inputMode="decimal"
              autoFocus
              value={reading}
              onChange={(e) => setReading(e.target.value)}
              placeholder={
                selected.current_meter != null
                  ? `> ${selected.current_meter}`
                  : '0'
              }
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-3 text-lg outline-none focus:border-white/40"
            />
            <button
              type="button"
              onClick={save}
              disabled={busy || !reading.trim()}
              className="w-full rounded-lg bg-green-600 py-3 font-semibold hover:bg-green-500 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              ) : (
                'Save reading'
              )}
            </button>
          </div>
        ) : null}
      </div>
    </main>
  )
}
